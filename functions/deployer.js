const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * Deploys the static files in the target directory to Firebase Hosting.
 * @param {Object} options 
 * @param {string} options.projectId - The Firebase project ID to deploy to.
 * @param {string} [options.token] - Optional Firebase token for authentication.
 * @param {boolean} [options.mock] - If true, runs a simulated deployment.
 * @returns {Promise<{success: boolean, output: string, url: string}>}
 */
async function deployToFirebase(options = {}) {
  const projectId = options.projectId || process.env.FIREBASE_PROJECT_ID || 'kamos-sketch-to-stitch';
  const token = options.token || process.env.FIREBASE_TOKEN || '';
  const isMock = options.mock || process.env.MOCK_DEPLOY === 'true';

  console.log(`[Deployer] Starting deployment to project: ${projectId} (Mock: ${isMock})`);

  if (isMock) {
    // Simulated deployment
    await new Promise(resolve => setTimeout(resolve, 2000));
    const mockUrl = `https://${projectId}.web.app`;
    return {
      success: true,
      output: `[MOCK DEPLOY] Successfully deployed to ${projectId}\nHosting URL: ${mockUrl}`,
      url: mockUrl
    };
  }

  return new Promise((resolve) => {
    // Setup environment variables for child process
    const env = { ...process.env };
    if (token) {
      env.FIREBASE_TOKEN = token;
    }

    // Run firebase deploy from the root directory of this repository
    const cmd = `npx firebase deploy --only hosting --project ${projectId}`;
    console.log(`[Deployer] Running command: ${cmd}`);

    exec(cmd, { cwd: __dirname, env }, (error, stdout, stderr) => {
      const output = stdout + '\n' + stderr;
      if (error) {
        console.error(`[Deployer] Error executing firebase deploy:`, error);
        resolve({
          success: false,
          output: output || error.message,
          url: ''
        });
        return;
      }

      // Try to parse the Hosting URL from output
      // Firebase output typically contains: "Hosting URL: https://<project-id>.web.app"
      let url = `https://${projectId}.web.app`;
      const urlRegex = /Hosting URL:\s*(https?:\/\/[^\s]+)/i;
      const match = stdout.match(urlRegex);
      if (match && match[1]) {
        url = match[1].trim();
      }

      console.log(`[Deployer] Deployment successful. URL: ${url}`);
      resolve({
        success: true,
        output: stdout,
        url: url
      });
    });
  });
}

module.exports = {
  deployToFirebase
};
