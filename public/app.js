document.addEventListener('DOMContentLoaded', () => {
    // API URL Helper to bypass Firebase Hosting 60-second timeout by calling Cloud Run/Functions directly in production
    function getApiUrl(endpoint) {
        const isProduction = window.location.hostname.endsWith('web.app') || window.location.hostname.endsWith('firebaseapp.com');
        const apiBase = isProduction ? 'https://api-4mgowf56dq-uc.a.run.app' : '';
        return `${apiBase}${endpoint}`;
    }

    // DOM Elements
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    const uploadPrompt = document.getElementById('upload-prompt');
    const previewContainer = document.getElementById('preview-container');
    const sketchPreview = document.getElementById('sketch-preview');
    const btnClearFile = document.getElementById('btn-clear-file');
    
    const stitchToneSelect = document.getElementById('stitch-tone-select');
    const guidancePrompt = document.getElementById('guidance-prompt');
    const btnGenerate = document.getElementById('btn-generate');
    const btnDeploy = document.getElementById('btn-deploy');
    
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabPanes = document.querySelectorAll('.tab-pane');
    
    const previewEmpty = document.getElementById('preview-empty');
    const previewIframe = document.getElementById('preview-iframe');
    const deployedSketchView = document.getElementById('deployed-sketch-view');
    const logConsole = document.getElementById('log-output');
    const loaderLogConsole = document.getElementById('loader-log-output');
    
    // Redirect textContent changes to loader log console in real-time
    if (logConsole && loaderLogConsole) {
        const originalDescriptor = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent');
        Object.defineProperty(logConsole, 'textContent', {
            get() {
                return originalDescriptor.get.call(this);
            },
            set(value) {
                originalDescriptor.set.call(this, value);
                originalDescriptor.set.call(loaderLogConsole, value);
                loaderLogConsole.scrollTop = loaderLogConsole.scrollHeight;
                this.scrollTop = this.scrollHeight;
            }
        });
    }

    
    const metaFooter = document.getElementById('meta-footer');
    const metaTheme = document.getElementById('meta-theme');
    const metaExplanation = document.getElementById('meta-explanation');
    
    const loaderOverlay = document.getElementById('loader-overlay');
    const loaderTitle = document.getElementById('loader-title');
    const loaderSubtitle = document.getElementById('loader-subtitle');
    const stepItems = [
        document.getElementById('step-0'),
        document.getElementById('step-1'),
        document.getElementById('step-2'),
        document.getElementById('step-3'),
        document.getElementById('step-4')
    ];
    
    const tabBtnKamos = document.getElementById('tab-btn-kamos');
    const kamosPlanOutput = document.getElementById('kamos-plan-output');
    
    const successModal = document.getElementById('success-modal');
    const deployedUrlInput = document.getElementById('deployed-url-input');
    const btnCopyUrl = document.getElementById('btn-copy-url');
    const btnVisitSite = document.getElementById('btn-visit-site');

    // State Variables
    let selectedFile = null;
    let compiledPreviewId = null;



    // File Selection Handlers
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleFileSelection(e.target.files[0]);
        }
    });

    // Drag and Drop Handlers
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('drag-over');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('drag-over');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        if (e.dataTransfer.files.length > 0) {
            handleFileSelection(e.dataTransfer.files[0]);
        }
    });

    function handleFileSelection(file) {
        if (!file.type.startsWith('image/')) {
            alert('画像ファイル（PNG、JPG、JPEG）を選択してください。');
            return;
        }
        selectedFile = file;
        const reader = new FileReader();
        reader.onload = (e) => {
            sketchPreview.src = e.target.result;
            uploadPrompt.style.display = 'none';
            previewContainer.style.display = 'flex';
        };
        reader.readAsDataURL(file);
    }

    btnClearFile.addEventListener('click', (e) => {
        e.stopPropagation();
        selectedFile = null;
        fileInput.value = '';
        sketchPreview.src = '';
        previewContainer.style.display = 'none';
        uploadPrompt.style.display = 'block';
    });

    // Update tone help text dynamically
    const toneHelpTexts = {
        toy_retro: "おもちゃのような赤色や青色、黄色を使った元気なデザインです。ボタンがぷっくりと飛び出して見えます。",
        pastel_drawing: "水彩えのぐやクレヨンのような、やさしい色合いのデザインです。角が丸く、やわらかい雰囲気になります。",
        future_sf: "みらいの宇宙船のそうさパネルのような、すこし暗い背景に光る文字が並ぶかっこいいデザインです。",
        pop_comic: "まんがのコマのように太い黒い枠線や、吹き出しマークを使った、にぎやかで動きのあるデザインです。"
    };

    if (stitchToneSelect) {
        const toneHelpText = document.getElementById('tone-help-text');
        stitchToneSelect.addEventListener('change', () => {
            const selectedVal = stitchToneSelect.value;
            if (toneHelpText && toneHelpTexts[selectedVal]) {
                toneHelpText.textContent = toneHelpTexts[selectedVal];
            }
        });
    }

    // Fetch and populate design tones dynamically from Firestore
    async function loadDesignTones() {
        if (!stitchToneSelect) return;
        
        try {
            const response = await fetch(getApiUrl('/api/list-tones'));
            if (!response.ok) throw new Error("Failed to load design tones.");
            const data = await response.json();
            
            if (data.success && data.tones && data.tones.length > 0) {
                // Clear existing options
                stitchToneSelect.innerHTML = '';
                
                // Clear and rebuild toneHelpTexts
                for (const key in toneHelpTexts) {
                    delete toneHelpTexts[key];
                }
                
                data.tones.forEach(tone => {
                    const option = document.createElement('option');
                    option.value = tone.id;
                    option.textContent = tone.label;
                    stitchToneSelect.appendChild(option);
                    
                    toneHelpTexts[tone.id] = tone.description;
                });
                
                // Select first tone by default and set help text
                const firstTone = data.tones[0];
                stitchToneSelect.value = firstTone.id;
                const toneHelpText = document.getElementById('tone-help-text');
                if (toneHelpText) {
                    toneHelpText.textContent = firstTone.description;
                }
            }
        } catch (err) {
            console.error("Error loading design tones:", err);
            // Fallback to defaults already in HTML if fetch fails
        }
    }

    loadDesignTones();

    // Tab Switching Logic
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.disabled) return;
            
            const tabId = btn.getAttribute('data-tab');
            
            tabBtns.forEach(b => b.classList.remove('active'));
            tabPanes.forEach(p => p.classList.remove('active'));
            
            btn.classList.add('active');
            document.getElementById(`pane-${tabId}`).classList.add('active');
        });
    });

    // Reset Steps Loader UI
    function resetLoaderSteps(title, subtitle) {
        loaderTitle.textContent = title;
        loaderSubtitle.textContent = subtitle;
        stepItems.forEach((item, idx) => {
            item.className = '';
            if (idx === 0) item.className = 'active';
        });
    }

    // Set step status
    function setStepStatus(idx, status) {
        if (idx < 0 || idx >= stepItems.length) return;
        stepItems[idx].className = status; // 'done', 'active', or ''
    }

    // Generate Layout Action
    btnGenerate.addEventListener('click', async () => {
        if (!selectedFile) {
            alert('はじめに、スケッチ画像をアップロードしてください。');
            return;
        }

        const projectId = '__create_new__';

        // Initialize Logs tab
        logConsole.textContent = `[システム] 🚀 ページの組み立て準備を開始しました...\n`;
        logConsole.textContent += `[システム] スケッチ画像をアップロードしています...\n`;
        logConsole.scrollTop = logConsole.scrollHeight;

        // Show Loader Overlay
        resetLoaderSteps("Webページを組み立て中...", "スケッチ画像をアップロードしています...");
        loaderOverlay.style.display = 'flex';

        try {
            // ==========================================
            // Step 0: Upload Sketch
            // ==========================================
            setStepStatus(0, 'active');
            
            const formData = new FormData();
            formData.append('sketch', selectedFile);

            const uploadResponse = await fetch(getApiUrl('/api/upload-sketch'), {
                method: 'POST',
                body: formData
            });

            if (!uploadResponse.ok) {
                const errData = await uploadResponse.json();
                throw new Error(errData.error || 'Failed to upload sketch image.');
            }

            const uploadData = await uploadResponse.json();
            const previewId = uploadData.previewId;
            const sketchUrl = uploadData.sketchUrl;

            logConsole.textContent += `[システム] ✅ 画像のアップロードが完了しました。\n`;
            logConsole.textContent += `[システム] AIによる手書きスケッチの解析を開始します...\n`;
            logConsole.scrollTop = logConsole.scrollHeight;
            loaderSubtitle.textContent = "AIがスケッチの枠組みと構成要素を認識しています...";

            await new Promise(r => setTimeout(r, 400)); // Smooth transition
            setStepStatus(0, 'done');

            // ==========================================
            // Step 1: Gemini Vision Analysis
            // ==========================================
            setStepStatus(1, 'active');

            const geminiResponse = await fetch(getApiUrl('/api/gemini-analyze'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    previewId,
                    prompt: guidancePrompt.value
                })
            });

            if (!geminiResponse.ok) {
                const errData = await geminiResponse.json();
                throw new Error(errData.error || 'Gemini Vision analysis failed.');
            }

            const geminiData = await geminiResponse.json();
            const { title, layoutStructure, extractedText, explanation } = geminiData;

            logConsole.textContent += `[AI] 👁️ 画像解析に成功しました。\n`;
            logConsole.textContent += `  - 画面タイトル: ${title}\n`;
            logConsole.textContent += `  - 認識した構造: ${layoutStructure.substring(0, 150)}...\n`;
            logConsole.textContent += `  - 抽出したテキスト: ${extractedText || 'なし'}\n`;
            logConsole.textContent += `  - Visionの解説: ${explanation}\n`;
            logConsole.textContent += `[システム] 🧠 カモスを起動中。ページの構成と文章の作成をリクエストしています...\n`;
            logConsole.scrollTop = logConsole.scrollHeight;
            loaderSubtitle.textContent = "カモスがページの構成と文章を考えています...";

            await new Promise(r => setTimeout(r, 400)); // Smooth transition
            setStepStatus(1, 'done');

            // ==========================================
            // Step 2: Kamos Orchestrated Planning
            // ==========================================
            setStepStatus(2, 'active');

            const kamosResponse = await fetch(getApiUrl('/api/kamos-plan'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title,
                    layoutStructure,
                    extractedText,
                    prompt: guidancePrompt.value,
                    tone: stitchToneSelect ? stitchToneSelect.value : 'toy_retro'
                })
            });

            if (!kamosResponse.ok) {
                const errData = await kamosResponse.json();
                throw new Error(errData.error || 'Kamos planning failed.');
            }

            const kamosData = await kamosResponse.json();
            const { stitchPrompt, kamosPlan = '' } = kamosData;

            logConsole.textContent += `[カモス] 💡 ページの構成と文章の決定が完了しました。\n`;
            
            // 企画プレビューをログに表示
            const planStr = typeof kamosPlan === 'string' ? kamosPlan : '';
            const planLines = planStr.split('\n').filter(l => l.trim() !== '');
            const planPreview = planLines.length > 0 ? planLines.slice(0, 5).join('\n    ') : '企画内容はありません。';
            logConsole.textContent += `  [企画案プレビュー]:\n    ${planPreview}\n    ...\n`;
            logConsole.textContent += `[システム] 構成案とスケッチの情報のマージ、および生成用プロンプトの合成が完了しました。\n`;
            logConsole.textContent += `[システム] StitchによるUI画面の生成をリクエストしています...\n`;
            logConsole.scrollTop = logConsole.scrollHeight;
            loaderSubtitle.textContent = "Webページのプログラムを組み立てています（約1分かかります）...";

            await new Promise(r => setTimeout(r, 400)); // Smooth transition
            setStepStatus(2, 'done');

            // ==========================================
            // Step 3: Stitch Page Generation
            // ==========================================
            setStepStatus(3, 'active');

            const stitchResponse = await fetch(getApiUrl('/api/stitch-generate'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    projectId,
                    stitchPrompt
                })
            });

            if (!stitchResponse.ok) {
                const errData = await stitchResponse.json();
                throw new Error(errData.error || 'Stitch screen generation failed.');
            }

            const stitchData = await stitchResponse.json();
            const downloadUrl = stitchData.downloadUrl;
            const theme = stitchData.theme;

            logConsole.textContent += `[Stitch] ✨ Webページコードの生成に成功しました！\n`;
            logConsole.textContent += `  - 適用されたテーマ: ${theme}\n`;
            logConsole.textContent += `  - ダウンロードURL: ${downloadUrl.substring(0, 80)}...\n`;
            logConsole.textContent += `[システム] 生成されたプログラムファイルをダウンロードしています...\n`;
            logConsole.scrollTop = logConsole.scrollHeight;
            loaderSubtitle.textContent = "プログラムファイルをダウンロードし、準備しています...";

            await new Promise(r => setTimeout(r, 400)); // Smooth transition
            setStepStatus(3, 'done');

            // ==========================================
            // Step 4: Stitch HTML Download and Save
            // ==========================================
            setStepStatus(4, 'active');

            const downloadResponse = await fetch(getApiUrl('/api/stitch-download'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    previewId,
                    downloadUrl
                })
            });

            if (!downloadResponse.ok) {
                const errData = await downloadResponse.json();
                throw new Error(errData.error || 'Failed to download HTML code.');
            }

            const downloadData = await downloadResponse.json();
            const previewUrl = downloadData.previewUrl;

            logConsole.textContent += `[システム] ✅ ファイルの保存が完了しました。プレビューURL: ${previewUrl}\n`;
            logConsole.textContent += `[システム] すべての組み立て処理が完了しました。公開の準備が整いました。\n`;
            logConsole.scrollTop = logConsole.scrollHeight;

            await new Promise(r => setTimeout(r, 400));
            setStepStatus(4, 'done');
            await new Promise(r => setTimeout(r, 200));

            // Hide Loader
            loaderOverlay.style.display = 'none';

            // Load iframe and data
            compiledPreviewId = previewId;
            previewEmpty.style.display = 'none';
            previewIframe.src = previewUrl;
            previewIframe.style.display = 'block';

            // Load sketch comparison tab image
            deployedSketchView.src = sketchUrl;
            document.getElementById('tab-btn-sketch').disabled = false;
            document.getElementById('tab-btn-logs').disabled = false;
            
            // Enable and populate Kamos Plan tab
            tabBtnKamos.disabled = false;
            kamosPlanOutput.innerHTML = parseMarkdown(kamosPlan);

            // Load metadata footer
            metaTheme.textContent = theme.toUpperCase();
            metaExplanation.textContent = explanation;
            metaFooter.style.display = 'block';

            // Enable deployment button
            btnDeploy.disabled = false;

            // Auto-switch back to preview tab if they were elsewhere
            document.querySelector('[data-tab="preview"]').click();

        } catch (err) {
            console.error(err);
            logConsole.textContent += `\n❌ [システムエラー] 組み立てに失敗しました: ${err.message}\n`;
            logConsole.scrollTop = logConsole.scrollHeight;
            loaderOverlay.style.display = 'none';
            alert(`組み立てに失敗しました: ${err.message}`);
        }
    });

    // Deploy to Hosting Action
    btnDeploy.addEventListener('click', async () => {
        if (!compiledPreviewId) return;

        // Switch to Logs Tab immediately to see output
        document.getElementById('tab-btn-logs').click();

        btnDeploy.disabled = true;
        logConsole.textContent = `[システム] 公開処理を準備しています...\n`;
        logConsole.textContent += `[システム] ファイルを公開用フォルダにコピーしています...\n`;

        // Open a secondary deployment loader screen with customized text
        loaderTitle.textContent = "インターネットに公開中...";
        loaderSubtitle.textContent = "公開サーバーにファイルを送信しています...";
        
        // Setup simple loader step texts for deployment
        stepItems[0].textContent = "ファイルを準備しています...";
        stepItems[1].textContent = "公開サーバーに接続しています...";
        stepItems[2].textContent = "ファイルをサーバーに送信しています...";
        stepItems[3].textContent = "公開URLを確認しています...";
        if (stepItems[4]) stepItems[4].style.display = 'none';
        
        resetLoaderSteps("インターネットに公開中...", "サーバーにファイルを送信しています...");
        loaderOverlay.style.display = 'flex';

        try {
            setStepStatus(0, 'active');
            await new Promise(r => setTimeout(r, 800));
            setStepStatus(0, 'done');
            setStepStatus(1, 'active');

            const response = await fetch(getApiUrl('/api/deploy'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: compiledPreviewId })
            });

            const data = await response.json();
            
            setStepStatus(1, 'done');
            setStepStatus(2, 'active');
            
            logConsole.textContent += data.output + '\n';
            logConsole.scrollTop = logConsole.scrollHeight;

            if (!data.success) {
                throw new Error("サーバーへのファイル送信に失敗しました。詳細は「動作の記録」を確認してください。");
            }

            await new Promise(r => setTimeout(r, 800));
            setStepStatus(2, 'done');
            setStepStatus(3, 'active');
            await new Promise(r => setTimeout(r, 600));
            setStepStatus(3, 'done');

            loaderOverlay.style.display = 'none';

            // Show Success Modal
            deployedUrlInput.value = data.url;
            btnVisitSite.href = data.url;
            successModal.style.display = 'flex';

            logConsole.textContent += `\n[システム] 公開に成功しました！\nURL: ${data.url}\n`;
            logConsole.scrollTop = logConsole.scrollHeight;

        } catch (err) {
            console.error(err);
            loaderOverlay.style.display = 'none';
            btnDeploy.disabled = false;
            logConsole.textContent += `\n❌ [システムエラー] 公開に失敗しました: ${err.message}\n`;
            logConsole.scrollTop = logConsole.scrollHeight;
            alert(`公開に失敗しました: ${err.message}`);
        } finally {
            // Restore default text on loader steps for next generation
            stepItems[0].textContent = "スケッチ画像をアップロードしています...";
            stepItems[1].textContent = "AIがスケッチの構造と意図を分析しています...";
            stepItems[2].textContent = "カモスがページの構成と文章を考えています...";
            stepItems[3].textContent = "StitchがWebページのプログラムを作成しています...";
            if (stepItems[4]) {
                stepItems[4].textContent = "作成したプログラムファイルを準備しています...";
                stepItems[4].style.display = 'flex';
            }
        }
    });

    // Copy Deployed URL to Clipboard
    btnCopyUrl.addEventListener('click', () => {
        deployedUrlInput.select();
        document.execCommand('copy');
        
        // Visual feedback
        const oldIcon = btnCopyUrl.innerHTML;
        btnCopyUrl.innerHTML = '<span class="material-symbols-outlined">done</span>';
        setTimeout(() => {
            btnCopyUrl.innerHTML = oldIcon;
        }, 1500);
    });

    // Helper to parse Markdown content into HTML elements
    function parseMarkdown(markdown) {
        if (!markdown) return '';
        
        let lines = markdown.split('\n');
        let inList = false;
        let htmlLines = [];
        
        for (let line of lines) {
            let processedLine = line;
            
            // Check list item
            if (processedLine.trim().startsWith('- ')) {
                if (!inList) {
                    htmlLines.push('<ul>');
                    inList = true;
                }
                const content = processedLine.trim().substring(2);
                htmlLines.push(`<li>${parseInlineMarkdown(content)}</li>`);
                continue;
            } else {
                if (inList) {
                    htmlLines.push('</ul>');
                    inList = false;
                }
            }
            
            // Check headers
            if (processedLine.startsWith('###### ')) {
                htmlLines.push(`<h6>${parseInlineMarkdown(processedLine.substring(7))}</h6>`);
            } else if (processedLine.startsWith('##### ')) {
                htmlLines.push(`<h5>${parseInlineMarkdown(processedLine.substring(6))}</h5>`);
            } else if (processedLine.startsWith('#### ')) {
                htmlLines.push(`<h4>${parseInlineMarkdown(processedLine.substring(5))}</h4>`);
            } else if (processedLine.startsWith('### ')) {
                htmlLines.push(`<h3>${parseInlineMarkdown(processedLine.substring(4))}</h3>`);
            } else if (processedLine.startsWith('## ')) {
                htmlLines.push(`<h2>${parseInlineMarkdown(processedLine.substring(3))}</h2>`);
            } else if (processedLine.startsWith('# ')) {
                htmlLines.push(`<h1>${parseInlineMarkdown(processedLine.substring(2))}</h1>`);
            } else if (processedLine.trim() === '') {
                htmlLines.push('<br>');
            } else {
                htmlLines.push(`<p>${parseInlineMarkdown(processedLine)}</p>`);
            }
        }
        
        if (inList) {
            htmlLines.push('</ul>');
        }
        
        return htmlLines.join('\n');
    }

    function escapeHtml(str) {
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function parseInlineMarkdown(text) {
        return escapeHtml(text)
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/`([^`]+)`/g, '<code>$1</code>');
    }
});
