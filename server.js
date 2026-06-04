require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { GoogleGenAI } = require('@google/genai');
const { deployToFirebase } = require('./deployer');

/**
 * Call Stitch remote MCP server over HTTP JSON-RPC
 */
async function callStitch(method, params = {}) {
  const payload = JSON.stringify({
    jsonrpc: '2.0',
    method: method,
    params: params,
    id: Date.now()
  });

  return new Promise((resolve, reject) => {
    const stitchUrl = process.env.STITCH_MCP_URL || 'https://stitch.googleapis.com/mcp';
    const stitchApiKey = process.env.STITCH_API_KEY;
    if (!stitchApiKey) {
      return reject(new Error('STITCH_API_KEY is not defined in the environment.'));
    }
    const req = https.request(stitchUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': stitchApiKey
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Failed to parse response: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

/**
 * Helper to download raw content from HTTPS URL
 */
function downloadUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

/**
 * Call Kamos remote function using HTTPS POST
 */
async function callKamos(toolName, args = {}) {
  const endpoint = process.env.KAMOS_ENDPOINT || 'https://processmcprequest-x2panoolwa-an.a.run.app';
  const token = process.env.KAMOS_API_TOKEN;
  if (!token) {
    throw new Error('KAMOS_API_TOKEN is not defined in the environment.');
  }

  const payload = JSON.stringify({
    data: {
      tool: toolName,
      prompt: args.prompt,
      includeKamosSpecs: args.includeKamosSpecs || false,
      useGoogleSearch: args.useGoogleSearch || false,
      includePastArticles: args.includePastArticles || false
    }
  });

  return new Promise((resolve, reject) => {
    const url = new URL(endpoint);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            console.error(`[Kamos] API Error:`, parsed.error);
            reject(new Error(`Kamos API error: ${parsed.error.message || JSON.stringify(parsed.error)}`));
          } else if (parsed.result === undefined) {
            console.error(`[Kamos] API returned no result. Raw response:`, data);
            reject(new Error(`Kamos API returned no result. Raw response: ${data}`));
          } else {
            resolve(parsed.result);
          }
        } catch (e) {
          reject(new Error(`Failed to parse Kamos response: ${data}. Error: ${e.message}`));
        }
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

/**
 * Helper to get or create a Stitch project by title
 */
async function getOrCreateDedicatedProject(title) {
  console.log(`[Stitch] Checking if project "${title}" exists...`);
  const listResponse = await callStitch('tools/call', {
    name: 'list_projects',
    arguments: {}
  });

  if (listResponse.error) {
    throw new Error(listResponse.error.message || 'Failed to list Stitch projects.');
  }

  if (!listResponse.result || !listResponse.result.content || !listResponse.result.content[0]) {
    throw new Error('Invalid response format from Stitch projects list.');
  }

  const resultObj = JSON.parse(listResponse.result.content[0].text);
  const projects = resultObj.projects || [];
  
  const existingProj = projects.find(p => p.title === title);
  if (existingProj) {
    const projectId = existingProj.name.split('/').pop();
    console.log(`[Stitch] Found existing project: ${title} (ID: ${projectId})`);
    return projectId;
  }

  console.log(`[Stitch] Project not found. Creating project: "${title}"...`);
  const createResponse = await callStitch('tools/call', {
    name: 'create_project',
    arguments: { title: title }
  });

  if (createResponse.error) {
    throw new Error(createResponse.error.message || 'Failed to create Stitch project.');
  }

  if (!createResponse.result || !createResponse.result.content || !createResponse.result.content[0]) {
    throw new Error('Invalid response format from Stitch project creation.');
  }

  const createdProj = JSON.parse(createResponse.result.content[0].text);
  const projectId = createdProj.name.split('/').pop();
  console.log(`[Stitch] Created new project: ${title} (ID: ${projectId})`);
  return projectId;
}

const app = express();
const PORT = process.env.PORT || 3000;

// Setup directories
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const PREVIEW_DIR = path.join(__dirname, 'public', 'preview');
const DIST_DIR = path.join(__dirname, 'dist');

[UPLOADS_DIR, PREVIEW_DIR, DIST_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Configure middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Configure Multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.png';
    cb(null, `sketch_${Date.now()}${ext}`);
  }
});
const upload = multer({ storage });

// Initialize Gemini SDK
if (!process.env.GEMINI_API_KEY) {
  console.warn("WARNING: GEMINI_API_KEY environment variable is not defined!");
}
if (!process.env.STITCH_API_KEY) {
  console.warn("WARNING: STITCH_API_KEY environment variable is not defined!");
}
if (!process.env.KAMOS_API_TOKEN) {
  console.warn("WARNING: KAMOS_API_TOKEN environment variable is not defined!");
}
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

// Read Theme Presets and Base Template
const PRESETS_PATH = path.join(__dirname, 'templates', 'theme-presets.json');
const BASE_HTML_PATH = path.join(__dirname, 'templates', 'base.html');

/**
 * Compiles index.html from template, theme parameters, and content
 */
function compileHtml(themeKey, generatedData) {
  const presets = JSON.parse(fs.readFileSync(PRESETS_PATH, 'utf8'));
  let baseHtml = fs.readFileSync(BASE_HTML_PATH, 'utf8');

  // Fallback to designography if theme not found
  const theme = presets[themeKey] || presets['designography'];

  // Font link preparation
  const fontImport = theme.fontImportUrl 
    ? `<link href="${theme.fontImportUrl}" rel="stylesheet">`
    : '';

  // Neural fluid animation blob style
  const blobStyle = theme.blobAnimationEnabled 
    ? `display: block;`
    : 'display: none;';

  // Extract custom brutalist styling if enabled, or inject Gemini custom CSS
  let combinedCss = '';
  if (theme.brutalistEnabled) {
    combinedCss += `
      .glass-card {
        border-radius: 0px !important;
        border: ${theme.borderWidth} solid ${theme.borderColor} !important;
        box-shadow: ${theme.boxShadow} !important;
        background: ${theme.surface} !important;
        transform: none !important;
      }
      .glass-card:hover {
        transform: translate(-3px, -3px) !important;
        box-shadow: 9px 9px 0px ${theme.offsetShadow} !important;
      }
      button, .btn {
        border-radius: 0px !important;
        border: 2px solid #000000 !important;
        box-shadow: 3px 3px 0px #000000 !important;
        color: #000000 !important;
        background: var(--primary-color) !important;
      }
      button:hover, .btn:hover {
        transform: translate(-1px, -1px) !important;
        box-shadow: 4px 4px 0px #000000 !important;
      }
    `;
  }
  if (generatedData.cssBrutalist) {
    combinedCss += '\n' + generatedData.cssBrutalist;
  }

  // Replace placeholders in base.html
  const replacements = {
    '{{TITLE}}': generatedData.title || 'Kamos Generated Page',
    '{{FONT_IMPORT}}': fontImport,
    '{{AMBIENT_BG}}': theme.ambientBg,
    '{{PRIMARY_COLOR}}': theme.primaryColor,
    '{{PRIMARY_CONTAINER}}': theme.primaryContainer,
    '{{SURFACE}}': theme.surface,
    '{{ON_SURFACE}}': theme.onSurface,
    '{{ON_SURFACE_VARIANT}}': theme.onSurfaceVariant,
    '{{FONT_FAMILY}}': theme.fontFamily || 'inherit',
    '{{BORDER_RADIUS}}': theme.borderRadius,
    '{{BORDER_WIDTH}}': theme.borderWidth,
    '{{BORDER_COLOR}}': theme.borderColor,
    '{{BOX_SHADOW}}': theme.boxShadow,
    '{{GLASS_BLUR}}': theme.glassBlur,
    '{{TRANSITION_SPEED}}': theme.transitionSpeed,
    '{{BLOB_DURATION}}': theme.blobDuration || '12s',
    '{{BRUTALIST_CSS}}': combinedCss,
    '{{BLOB_STYLE}}': blobStyle,
    '{{CONTENT}}': generatedData.htmlContent || '<div>No content generated</div>'
  };

  let compiled = baseHtml;
  for (const [key, value] of Object.entries(replacements)) {
    // Replace all occurrences
    compiled = compiled.split(key).join(value);
  }

  return compiled;
}

// Endpoint: List Stitch Projects
app.get('/api/stitch-projects', async (req, res) => {
  try {
    console.log("Listing projects from Stitch...");
    const mcpResponse = await callStitch('tools/call', {
      name: 'list_projects',
      arguments: {}
    });

    if (mcpResponse.error) {
      throw new Error(mcpResponse.error.message || 'Stitch MCP returned an error.');
    }

    if (!mcpResponse.result || !mcpResponse.result.content || !mcpResponse.result.content[0]) {
      throw new Error('Invalid response format from Stitch MCP.');
    }

    const textContent = mcpResponse.result.content[0].text;
    const resultObj = JSON.parse(textContent);

    res.json({
      success: true,
      projects: resultObj.projects || []
    });

  } catch (err) {
    console.error("Error listing Stitch projects:", err);
    res.status(500).json({ error: err.message || "Failed to list Stitch projects." });
  }
});

// Endpoint: Upload Sketch
app.post('/api/upload-sketch', upload.single('sketch'), async (req, res) => {
  console.log("📥 Received layout upload request...");
  if (!req.file) {
    return res.status(400).json({ error: "No sketch image file uploaded." });
  }

  const imagePath = req.file.path;
  const ext = path.extname(req.file.originalname) || '.png';
  const previewId = `preview_${Date.now()}`;
  const specificPreviewDir = path.join(PREVIEW_DIR, previewId);

  try {
    fs.mkdirSync(specificPreviewDir, { recursive: true });
    // Move from temporary upload path to preview folder
    const newImagePath = path.join(specificPreviewDir, `sketch${ext}`);
    fs.renameSync(imagePath, newImagePath);

    console.log(`[Upload] Sketch saved to ${newImagePath}`);
    res.json({
      success: true,
      previewId,
      sketchUrl: `/preview/${previewId}/sketch${ext}`
    });
  } catch (err) {
    console.error("Error uploading sketch:", err);
    res.status(500).json({ error: err.message || "Failed to upload sketch." });
  }
});

// Endpoint: Analyze Sketch with Gemini Vision
app.post('/api/gemini-analyze', async (req, res) => {
  const { previewId, prompt = '' } = req.body;
  if (!previewId) {
    return res.status(400).json({ error: "Preview ID is required." });
  }

  const specificPreviewDir = path.join(PREVIEW_DIR, previewId);
  if (!fs.existsSync(specificPreviewDir)) {
    return res.status(404).json({ error: `Preview directory not found: ${previewId}` });
  }

  const files = fs.readdirSync(specificPreviewDir);
  const sketchFile = files.find(f => f.startsWith('sketch'));
  if (!sketchFile) {
    return res.status(404).json({ error: "Sketch file not found in preview directory." });
  }

  const imagePath = path.join(specificPreviewDir, sketchFile);
  const ext = path.extname(sketchFile).toLowerCase();
  let mimeType = 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') mimeType = 'image/jpeg';
  else if (ext === '.webp') mimeType = 'image/webp';

  try {
    console.log(`👁️ Processing sketch using Gemini Vision API (gemini-3-flash-preview)...`);
    const imageBase64 = fs.readFileSync(imagePath).toString('base64');

    const systemPrompt = `You are Kamos Sketch-to-Stitch Vision Analyzer, an elite AI frontend designer and UI/UX expert.
Your job is to analyze this hand-drawn UI sketch or wireframe image and extract its structure, text content, and layout properties.

YOUR OUTPUT REQUIREMENTS:
1. Output MUST be valid JSON matching the schema below.
2. In the "title" field, provide a short, descriptive page title in Japanese.
3. In the "layoutStructure" field, describe the overall layout structure in English (e.g. "A header at the top with logo left and navigation right, a main body split into a 25% sidebar and 75% dashboard feed...").
4. In the "extractedText" field, list all texts, labels, and text elements found on the sketch.
5. In the "explanation" field, provide a short 2-3 sentence description in Japanese explaining the visual components you observed.

JSON OUTPUT SCHEMA:
{
  "title": "A short, descriptive page title in Japanese",
  "layoutStructure": "Detailed layout structure description in English.",
  "extractedText": "Extracted text and labels in English.",
  "explanation": "A short, 2-3 sentence description in Japanese explaining what was extracted."
}

User Guidance / Prompt overrides: ${prompt}
`;

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: [
        {
          role: 'user',
          parts: [
            { text: systemPrompt },
            { inlineData: { data: imageBase64, mimeType } }
          ]
        }
      ],
      config: {
        responseMimeType: 'application/json'
      }
    });

    console.log("✅ Received prompt instructions from Gemini.");
    
    let resultData;
    try {
      resultData = JSON.parse(response.text);
    } catch (parseErr) {
      console.error("Failed to parse Gemini JSON:", response.text);
      return res.status(500).json({ error: "Failed to parse design instructions from Gemini." });
    }

    res.json({
      success: true,
      title: resultData.title,
      layoutStructure: resultData.layoutStructure,
      extractedText: resultData.extractedText,
      explanation: resultData.explanation
    });

  } catch (err) {
    console.error("Error in Gemini analysis:", err);
    res.status(500).json({ error: err.message || "Gemini analysis failed." });
  }
});

// Endpoint: Plan with Kamos & Synthesize Stitch Prompt
app.post('/api/kamos-plan', async (req, res) => {
  const { title, layoutStructure, extractedText, prompt = '' } = req.body;

  if (!layoutStructure) {
    return res.status(400).json({ error: "layoutStructure is required." });
  }

  try {
    console.log(`🧠 Orchestrating planning with Kamos...`);

    const kamosPrompt = `You are the lead UX designer and content strategist in Kamos.
We are building a web application screen. We have parsed the following layout and elements from a user's UI sketch:
- Screen Title: ${title}
- Layout Structure: ${layoutStructure}
- Extracted Sketch Text: ${extractedText}
- User Instructions: ${prompt}

Your job is to plan the exact content strategy, copywriting, messaging, and realistic mock data specs to make this screen look complete and premium. Do not use generic placeholders like "Lorem Ipsum".
Please analyze and define the following details:
1. **Core Experience Strategy**: The purpose of this screen and how it serves the user.
2. **Premium Copywriting & Headings**: Specific taglines, headings, descriptions, and button labels to use.
3. **Data Specifications**: A rich set of realistic mock data rows/items (e.g., table logs, cards, list items) with details. Write the mock data details as plain text or key-value list (e.g., - ID: test-01, Name: User Auth, Type: Security), NOT as raw JSON blocks or JavaScript arrays, as raw code blocks break our parser.
4. **Enhanced UI Details**: Micro-copy or helper texts that make the interface intuitive.

Please write the descriptions in Japanese, but write the specific copywriting and mock data details in English so they can be easily used in code generation.
Do NOT use raw JSON code blocks or backslash escape characters in any of the sections.
`;

    // Call Kamos (using ask_kamos tool via HTTPS Callable)
    const kamosPlanResult = await callKamos('ask_kamos', {
      prompt: kamosPrompt,
      includeKamosSpecs: false
    });

    console.log(`[Kamos] raw result type: ${typeof kamosPlanResult}`);
    console.log(`[Kamos] raw result keys: ${kamosPlanResult ? Object.keys(kamosPlanResult).join(', ') : 'null'}`);

    // Extract and reconstruct the markdown report from Kamos matrix output
    let kamosPlanMarkdown = '';
    if (kamosPlanResult && typeof kamosPlanResult === 'object') {
      const reportObj = kamosPlanResult.report;
      if (reportObj && typeof reportObj === 'object') {
        // Reconstruct layout based on multidimensional matrix definition
        let formattedReport = `# Kamos 企画書: ${title || '無題の画面'}\n\n`;
        const sections = kamosPlanResult.framework?.sections || [];
        if (sections.length > 0) {
          const section = sections[0];
          const rows = section.rows || [];
          const columns = section.columns || [];
          
          for (let r = 0; r < rows.length; r++) {
            const row = rows[r];
            formattedReport += `## ${row.title}\n\n`;
            for (let c = 0; c < columns.length; c++) {
              const col = columns[c];
              const cellKey = `section-1-row-${r}-col-${c}`;
              const cellText = reportObj[cellKey];
              if (cellText) {
                formattedReport += `### ${col.title}\n${cellText}\n\n`;
              }
            }
          }
        } else {
          // Fallback: just dump all values if framework structure differs
          for (const [key, value] of Object.entries(reportObj)) {
            formattedReport += `### ${key}\n${value}\n\n`;
          }
        }
        kamosPlanMarkdown = formattedReport;
      } else if (typeof reportObj === 'string') {
        kamosPlanMarkdown = reportObj;
      } else {
        kamosPlanMarkdown = JSON.stringify(kamosPlanResult);
      }
    } else if (typeof kamosPlanResult === 'string') {
      kamosPlanMarkdown = kamosPlanResult;
    }

    console.log(`✅ Received planning from Kamos. Synthesizing final Stitch prompt...`);

    // Synthesize Stitch Prompt using Gemini 3-flash-preview
    const synthesisSystemPrompt = `You are Kamos Sketch-to-Stitch Prompt Synthesizer.
Your task is to combine the original sketch layout structure and the Kamos-generated planning document into a single, highly-detailed text prompt that will be fed into Stitch (an AI text-to-UI screen generator).

Inputs:
- Screen Title: ${title}
- Sketch Layout: ${layoutStructure}
- Extracted Sketch Text: ${extractedText}
- User Instructions: ${prompt}
- Kamos Plan: ${kamosPlanMarkdown}

Your output MUST be a detailed, structured prompt in English for Stitch UI generation.
It must describe:
1. The overall layout container, structural grids, headers, sidebars, and panels (based on the Sketch Layout).
2. The specific typography, font imports, and spacing guidelines.
3. The exact premium copy, headings, and detailed mock data (tables, cards, list items) planned by Kamos. Include the actual texts and data structures from Kamos!
4. The exact forms, input fields, buttons, and call-to-actions.

Your final output MUST be a valid JSON matching this schema:
{
  "stitchPrompt": "The synthesized highly-detailed English text prompt for Stitch UI generator."
}
`;

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: [
        { text: synthesisSystemPrompt }
      ],
      config: {
        responseMimeType: 'application/json'
      }
    });

    let synthesisData;
    try {
      synthesisData = JSON.parse(response.text);
    } catch (err) {
      console.error("Failed to parse synthesis JSON:", response.text);
      return res.status(500).json({ error: "Failed to parse synthesized prompt instructions." });
    }

    res.json({
      success: true,
      stitchPrompt: synthesisData.stitchPrompt,
      kamosPlan: kamosPlanMarkdown
    });

  } catch (err) {
    console.error("Error in Kamos planning phase:", err);
    res.status(500).json({ error: err.message || "Kamos planning failed." });
  }
});


// Endpoint: Dispatch to Stitch
app.post('/api/stitch-generate', async (req, res) => {
  const { projectId, stitchPrompt } = req.body;
  if (!projectId) {
    return res.status(400).json({ error: "Project ID is required." });
  }
  if (!stitchPrompt) {
    return res.status(400).json({ error: "Stitch prompt is required." });
  }

  let resolvedProjectId = projectId;

  try {
    // Resolve dynamic project IDs
    if (resolvedProjectId === "__create_dedicated__") {
      resolvedProjectId = await getOrCreateDedicatedProject("Kamos Sketch-to-Stitch");
    } else if (resolvedProjectId === "__create_new__") {
      const timestamp = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
      resolvedProjectId = await getOrCreateDedicatedProject(`Sketch to Stitch ${timestamp}`);
    }

    console.log(`🚀 Dispatching generation prompt to Stitch (Project: ${resolvedProjectId})...`);
    const stitchResponse = await callStitch('tools/call', {
      name: 'generate_screen_from_text',
      arguments: {
        projectId: resolvedProjectId,
        prompt: stitchPrompt
      }
    });

    if (stitchResponse.error) {
      throw new Error(stitchResponse.error.message || 'Stitch screen generation failed.');
    }

    if (!stitchResponse.result || !stitchResponse.result.content || !stitchResponse.result.content[0]) {
      throw new Error('Invalid response format from Stitch screen generation.');
    }

    const stitchResultObj = JSON.parse(stitchResponse.result.content[0].text);
    console.log("[Stitch] Result keys:", Object.keys(stitchResultObj));
    console.log("[Stitch] Full Response Text:", stitchResponse.result.content[0].text);
    
    // Find design object inside outputComponents array
    const designComponent = stitchResultObj.outputComponents && stitchResultObj.outputComponents.find(c => c.design);
    const screen = designComponent && designComponent.design && designComponent.design.screens && designComponent.design.screens[0];

    if (!screen || !screen.htmlCode || !screen.htmlCode.downloadUrl) {
      throw new Error('Stitch generated the screen but did not output compile-ready HTML code.');
    }

    // Determine display name of the project's design system/theme
    let themeDisplayName = 'Stitch Default';
    const dsComponent = stitchResultObj.outputComponents && stitchResultObj.outputComponents.find(c => c.designSystem);
    if (dsComponent && dsComponent.designSystem && dsComponent.designSystem.designSystem) {
      themeDisplayName = dsComponent.designSystem.designSystem.displayName || 'Stitch Design System';
    }

    res.json({
      success: true,
      downloadUrl: screen.htmlCode.downloadUrl,
      theme: themeDisplayName,
      resolvedProjectId
    });

  } catch (err) {
    console.error("Error in Stitch generation:", err);
    res.status(500).json({ error: err.message || "Stitch generation failed." });
  }
});

// Endpoint: Download Screen HTML from Stitch
app.post('/api/stitch-download', async (req, res) => {
  const { previewId, downloadUrl: remoteUrl } = req.body;
  if (!previewId) {
    return res.status(400).json({ error: "Preview ID is required." });
  }
  if (!remoteUrl) {
    return res.status(400).json({ error: "Download URL is required." });
  }

  const specificPreviewDir = path.join(PREVIEW_DIR, previewId);
  if (!fs.existsSync(specificPreviewDir)) {
    return res.status(404).json({ error: `Preview directory not found: ${previewId}` });
  }

  try {
    console.log(`📥 Downloading generated HTML from Stitch: ${remoteUrl}`);
    const downloadedHtml = await downloadUrl(remoteUrl);

    // Save compiled index.html
    fs.writeFileSync(path.join(specificPreviewDir, 'index.html'), downloadedHtml, 'utf8');

    res.json({
      success: true,
      previewUrl: `/preview/${previewId}/index.html`
    });

  } catch (err) {
    console.error("Error downloading Stitch HTML:", err);
    res.status(500).json({ error: err.message || "Failed to download generated HTML from Stitch." });
  }
});

// Endpoint: Deploy to Firebase Hosting
app.post('/api/deploy', async (req, res) => {
  const { id } = req.body;
  if (!id) {
    return res.status(400).json({ error: "Missing preview ID." });
  }

  const previewSource = path.join(PREVIEW_DIR, id, 'index.html');
  if (!fs.existsSync(previewSource)) {
    return res.status(404).json({ error: "Preview files not found." });
  }

  try {
    console.log(`[Server] Preparing files for deployment...`);
    
    // Ensure dashboard files are in dist/ to keep the dashboard running at root
    const filesToCopy = ['index.html', 'app.js', 'style.css'];
    filesToCopy.forEach(file => {
      const src = path.join(__dirname, 'public', file);
      const dest = path.join(DIST_DIR, file);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, dest);
      }
    });

    // Create unique directory for this site preview in dist/p/<id>
    const distPreviewDir = path.join(DIST_DIR, 'p', id);
    fs.mkdirSync(distPreviewDir, { recursive: true });

    // Copy the index.html of the preview
    const distHtmlPath = path.join(distPreviewDir, 'index.html');
    fs.copyFileSync(previewSource, distHtmlPath);

    // Run deployment
    // If local without environment variables, it will run mock deployment if MOCK_DEPLOY=true
    const deployOptions = {
      projectId: process.env.FIREBASE_PROJECT_ID || 'kamos-sketch-to-stitch',
      token: process.env.FIREBASE_TOKEN || '',
      mock: !process.env.FIREBASE_TOKEN && !fs.existsSync(path.join(process.env.HOME || '', '.config', 'configstore', 'firebase-tools.json'))
    };

    const deployResult = await deployToFirebase(deployOptions);

    // Append the subdirectory to the hosting URL
    const deployedUrl = deployResult.url.endsWith('/') 
      ? `${deployResult.url}p/${id}/`
      : `${deployResult.url}/p/${id}/`;

    res.json({
      success: deployResult.success,
      output: deployResult.output,
      url: deployedUrl
    });

  } catch (err) {
    console.error("Error during deployment:", err);
    res.status(500).json({ error: err.message || "Deployment failed." });
  }
});

// Start Express Server
app.listen(PORT, () => {
  console.log(`⚡ Kamos Sketch-to-Stitch server running on http://localhost:${PORT}`);
});
