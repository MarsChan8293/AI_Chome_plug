(function() {
    // 尝试绕过 window.top 校验
    try {
        if (window.self !== window.top) {
            Object.defineProperty(window, 'top', {
                get: function() { return window.self; }
            });
        }
    } catch (e) {}

    console.log("[AI Aggregator] Content script active on:", window.location.host);

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.type === 'SEND_AI_MESSAGE') {
            console.log("[AI Aggregator] Received message to send:", request.text.substring(0, 20) + "...");
            handleSendMessage(request.text);
        } else if (request.type === 'SYNC_INPUT') {
            // 实时同步输入：只填充文字，不触发发送
            console.log("[AI Aggregator] Syncing input:", request.text.substring(0, 20) + "...");
            // M365/GitHub Copilot：避免实时同步导致重复写入/干扰编辑器状态。
            // 需求：只在发送时写入（SEND_AI_MESSAGE），不做实时同步。
            if (window.location.host.includes('m365.cloud.microsoft') || window.location.host.includes('github.com')) {
                return;
            }

            // 其他站点：做轻量重试避免“找不到输入框”
            attemptFillInputWithRetries(request.text, 6, 250);
        } else if (request.type === 'NEW_CONVERSATION') {
            console.log("[AI Aggregator] Received new conversation request");
            handleNewConversation();
        }
    });

    function attemptFillInputWithRetries(text, maxAttempts = 5, delayMs = 200) {
        let attempts = 0;

        const run = () => {
            attempts += 1;

            // 避免 fillInputWithText 在找不到元素时刷屏报错
            const inputEl = findInputElement();
            if (inputEl) {
                fillInputWithText(text, false);
                return;
            }

            if (attempts >= maxAttempts) return;
            setTimeout(run, delayMs);
        };

        run();
    }

    // 输入框选择器（复用于填充和发送）
    const inputSelectors = [
        'textarea#chat-input',
        // M365 Copilot
        'textarea[placeholder*="Copilot"]',
        'textarea[aria-label*="Copilot"]',
        'textarea[placeholder*="发送消息"]',
        'textarea[aria-label*="发送消息"]',
        '[role="textbox"][aria-label*="Copilot"]',
        '[role="textbox"][aria-label*="发送消息"]',
        'div[contenteditable="true"][aria-label*="Copilot"]',
        'div[contenteditable="true"][aria-label*="发送消息"]',
        'div[contenteditable="true"][data-placeholder*="Copilot"]',
        'div[contenteditable="true"][data-placeholder*="发送"]',

        // GitHub Copilot
        'textarea[placeholder*="Ask Copilot"]',
        'textarea[aria-label*="Ask Copilot"]',
        'textarea[placeholder*="Ask me"]',
        '[role="textbox"][aria-label*="Ask Copilot"]',
        'div[contenteditable="true"][aria-label*="Ask Copilot"]',
        'div[contenteditable="true"][data-placeholder*="Ask Copilot"]',

        'textarea[placeholder*="问"]',
        'textarea[placeholder*="Ask"]',
        'textarea[placeholder*="输入"]',
        'textarea',
        '[role="textbox"]',
        'div[contenteditable="true"]',
        '.chat-input'
    ];

    function isVisible(el) {
        if (!el) return false;
        if (el.offsetParent !== null) return true;
        try {
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
        } catch (e) {
            return false;
        }
    }

    // 查找可见的输入框
    function findInputElement() {
        const host = window.location.host;

        // GitHub Copilot：优先选择明确的对话输入框
        if (host.includes('github.com')) {
            const copilotSelectors = [
                'textarea[placeholder*="Ask Copilot"]',
                'textarea[aria-label*="Ask Copilot"]',
                'textarea[placeholder*="Ask me"]',
                '[role="textbox"][aria-label*="Ask Copilot"]',
                'div[contenteditable="true"][aria-label*="Ask Copilot"]',
                'div[contenteditable="true"][data-placeholder*="Ask Copilot"]'
            ];
            for (const selector of copilotSelectors) {
                const candidates = querySelectorAllDeep(selector);
                for (const el of candidates) {
                    if (isVisible(el)) return el;
                }
            }

            // GitHub 可能存在多个输入框：弱匹配后打分选"最像聊天输入框"的
            const candidates = querySelectorAllDeep('textarea, input[type="text"], [role="textbox"], div[contenteditable="true"], [contenteditable="true"]');

            function scoreCandidate(el) {
                if (!isVisible(el)) return -9999;
                if (el.disabled) return -9999;
                if (el.getAttribute('aria-disabled') === 'true') return -9999;
                if (el.getAttribute('contenteditable') === 'false') return -9999;
                if (el.readOnly) return -9999;

                const aria = (el.getAttribute('aria-label') || '').toLowerCase();
                const placeholder = (el.getAttribute('placeholder') || '').toLowerCase();
                const role = (el.getAttribute('role') || '').toLowerCase();
                const id = (el.id || '').toLowerCase();
                const cls = (el.className || '').toString().toLowerCase();

                let score = 0;

                // 语义/文案
                if (aria.includes('copilot') || placeholder.includes('copilot')) score += 60;
                if (aria.includes('ask') || placeholder.includes('ask')) score += 40;
                if (aria.includes('message') || placeholder.includes('message')) score += 25;
                if (role === 'textbox') score += 10;

                // 排除搜索/过滤
                if (aria.includes('search') || placeholder.includes('search') || id.includes('search') || cls.includes('search')) score -= 80;
                if (aria.includes('filter') || placeholder.includes('filter')) score -= 60;

                // 位置：聊天输入一般靠近底部
                try {
                    const rect = el.getBoundingClientRect();
                    if (rect.top > window.innerHeight * 0.45) score += 20;
                    if (rect.top > window.innerHeight * 0.70) score += 15;
                    if (rect.top < window.innerHeight * 0.20) score -= 25;
                } catch (e) {}

                // 形态
                const tag = (el.tagName || '').toUpperCase();
                if (tag === 'TEXTAREA') score += 25;
                if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') score += 15;

                return score;
            }

            const best = candidates
                .map(el => ({ el, score: scoreCandidate(el) }))
                .sort((a, b) => b.score - a.score)[0];

            if (best && best.score > 0) {
                return best.el;
            }
        }

        // M365 Copilot：优先选择明确的对话输入框
        if (host.includes('m365.cloud.microsoft')) {
            const m365Selectors = [
                'textarea[placeholder*="Copilot"]',
                'textarea[aria-label*="Copilot"]',
                'textarea[placeholder*="发送消息"]',
                'textarea[aria-label*="发送消息"]',
                '[role="textbox"][aria-label*="Copilot"]',
                '[role="textbox"][aria-label*="发送消息"]',
                'div[contenteditable="true"][aria-label*="Copilot"]',
                'div[contenteditable="true"][aria-label*="发送消息"]',
                'div[contenteditable="true"][data-placeholder*="Copilot"]',
                'div[contenteditable="true"][data-placeholder*="发送"]'
            ];
            for (const selector of m365Selectors) {
                const candidates = querySelectorAllDeep(selector);
                for (const el of candidates) {
                    if (isVisible(el)) return el;
                }
            }

            // M365 可能存在多个 textbox（搜索框/侧栏等）：弱匹配后打分选“最像聊天输入框”的
            const candidates = querySelectorAllDeep('textarea, input[type="text"], [role="textbox"], div[contenteditable="true"], [contenteditable="true"]');

            function scoreCandidate(el) {
                if (!isVisible(el)) return -9999;
                if (el.disabled) return -9999;
                if (el.getAttribute('aria-disabled') === 'true') return -9999;
                if (el.getAttribute('contenteditable') === 'false') return -9999;
                if (el.readOnly) return -9999;

                const aria = (el.getAttribute('aria-label') || '').toLowerCase();
                const placeholder = (el.getAttribute('placeholder') || '').toLowerCase();
                const role = (el.getAttribute('role') || '').toLowerCase();
                const id = (el.id || '').toLowerCase();
                const cls = (el.className || '').toString().toLowerCase();

                let score = 0;

                // 语义/文案
                if (aria.includes('copilot') || placeholder.includes('copilot')) score += 60;
                if (aria.includes('发送') || placeholder.includes('发送')) score += 40;
                if (aria.includes('message') || placeholder.includes('message')) score += 25;
                if (role === 'textbox') score += 10;

                // 排除搜索/过滤
                if (aria.includes('search') || placeholder.includes('search') || id.includes('search') || cls.includes('search')) score -= 80;
                if (aria.includes('filter') || placeholder.includes('filter')) score -= 60;

                // 位置：聊天输入一般靠近底部
                try {
                    const rect = el.getBoundingClientRect();
                    if (rect.top > window.innerHeight * 0.45) score += 20;
                    if (rect.top > window.innerHeight * 0.70) score += 15;
                    if (rect.top < window.innerHeight * 0.20) score -= 25;
                } catch (e) {}

                // 形态
                const tag = (el.tagName || '').toUpperCase();
                if (tag === 'TEXTAREA') score += 25;
                if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') score += 15;

                return score;
            }

            const best = candidates
                .map(el => ({ el, score: scoreCandidate(el) }))
                .sort((a, b) => b.score - a.score)[0];

            if (best && best.score > 0) {
                return best.el;
            }
        }

        // Kimi 页面上可能存在多个 contenteditable，优先选择真实输入框
        if (host.includes('kimi')) {
            const candidates = document.querySelectorAll('[role="textbox"]');
            for (const el of candidates) {
                if (!el) continue;
                if (!isVisible(el)) continue;
                // 真实输入框通常是 contenteditable
                const isEditable = el.isContentEditable || el.getAttribute('contenteditable') === 'true';
                if (!isEditable) continue;
                return el;
            }
        }

        for (const selector of inputSelectors) {
            let el = null;
            try {
                el = document.querySelector(selector);
            } catch (e) {
                continue;
            }
            if (isVisible(el)) { // 确保元素可见
                return el;
            }
        }
        return null;
    }

    // 深度查询（包含 shadow DOM）
    function querySelectorAllDeep(selector) {
        const result = [];
        const stack = [document];
        while (stack.length) {
            const root = stack.pop();
            if (!root.querySelectorAll) continue;
            try {
                root.querySelectorAll(selector).forEach(el => result.push(el));
            } catch (e) {
                // ignore invalid selector for this root
            }
            root.querySelectorAll('*').forEach(el => {
                if (el.shadowRoot) stack.push(el.shadowRoot);
            });
        }
        return result;
    }

    // 填充输入框文字（不触发发送）
    // shouldFocus: 是否让输入框获得焦点，同步时设为 false 避免抢焦点
    function fillInputWithText(text, shouldFocus = false) {
        const inputEl = findInputElement();
        if (!inputEl) {
            console.error("[AI Aggregator] Could not find input element on", window.location.host);
            return null;
        }

        const host = window.location.host;

        if (shouldFocus) {
            try {
                inputEl.focus({ preventScroll: true });
            } catch (e) {
                inputEl.focus();
            }
        }
        
        if (inputEl.tagName === 'TEXTAREA' || inputEl.tagName === 'INPUT') {
            // React/Vue: 使用原生 setter 触发框架感知
            const isTextArea = inputEl.tagName === 'TEXTAREA';
            const proto = isTextArea ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
            const nativeValueSetter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
            if (nativeValueSetter) {
                nativeValueSetter.call(inputEl, text);
            } else {
                inputEl.value = text;
            }
        } else {
            // 针对 contenteditable 的特殊处理 (如 Kimi, 元宝)
            // Kimi：同步时绝不修改 Selection/焦点（否则会把焦点抢到 iframe）
            if (host.includes('kimi')) {
                if (shouldFocus) {
                    // 发送场景允许聚焦：尽量用 execCommand 让站点编辑器感知到“用户输入”
                    try {
                        document.execCommand('selectAll', false, null);
                        document.execCommand('insertText', false, text);
                    } catch (e) {
                        // fallback
                        inputEl.innerText = text;
                    }
                } else {
                    // 同步场景：不聚焦、不动选区，仅更新内容
                    inputEl.innerText = text;
                }
            } else if (host.includes('m365.cloud.microsoft') || host.includes('github.com')) {
                // M365 Copilot / GitHub Copilot：发送按钮通常在“真实输入事件”后才会出现
                // shouldFocus=false 时不抢焦点，仅更新可见内容；shouldFocus=true 时用 execCommand 触发站点编辑器状态更新
                if (shouldFocus) {
                    try {
                        document.execCommand('selectAll', false, null);
                        document.execCommand('insertText', false, text);
                    } catch (e) {
                        inputEl.innerText = text;
                    }
                } else {
                    // 不抢焦点时尽量覆盖更多字段，提升不同编辑器兼容性
                    inputEl.innerText = text;
                    inputEl.textContent = text;
                }
            } else {
                // 其他 contenteditable（如元宝）
                inputEl.textContent = '';
                inputEl.textContent = text;
            }
        }

        // 触发事件以确保框架（React/Vue）感知到输入
        // 注意：Kimi 的编辑器对 beforeinput/InputEvent(data=...) 很敏感，容易造成“写入后又插入一遍”
        // 同时不要在同步阶段派发 blur/或改 Selection，否则容易抢焦点
        const isKimi = host.includes('kimi');
        const isM365 = host.includes('m365.cloud.microsoft') || host.includes('github.com');
        const isContentEditable = !(inputEl.tagName === 'TEXTAREA' || inputEl.tagName === 'INPUT');

        // Kimi/M365 的编辑器对 InputEvent(data=...) 较敏感，可能导致“写入后又插入一遍”
        if (!((isKimi || isM365) && isContentEditable)) {
            try {
                inputEl.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, data: text, inputType: 'insertReplacementText' }));
            } catch (e) {
                // ignore
            }
            try {
                inputEl.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, data: text, inputType: 'insertText' }));
            } catch (e) {
                // ignore
            }
        }

        // 如果在 shadow DOM 中，同时更新宿主节点的 value 并派发事件（如 Fluent TextArea）
        const rootNode = inputEl.getRootNode && inputEl.getRootNode();
        const hostEl = rootNode && rootNode.host;
        if (hostEl) {
            try {
                if ('value' in hostEl) hostEl.value = text;
                hostEl.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
                hostEl.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
            } catch (e) {
                // ignore
            }
        }

        // M365：有时需要再补一轮标准 input 事件，让发送按钮状态刷新
        if (isM365) {
            try {
                inputEl.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
            } catch (e) {
                // ignore
            }
        }

        const events = shouldFocus ? ['input', 'change', 'compositionend'] : ['input', 'change'];
        events.forEach(evtType => {
            try {
                inputEl.dispatchEvent(new Event(evtType, { bubbles: true, cancelable: true }));
            } catch (e) {
                // ignore
            }
        });

        return inputEl;
    }

    async function handleSendMessage(text) {
        const host = window.location.host;

        function simulateEnter(target) {
            const eventInit = {
                key: 'Enter',
                code: 'Enter',
                keyCode: 13,
                which: 13,
                bubbles: true,
                cancelable: true,
                composed: true,
                shiftKey: false
            };
            target.dispatchEvent(new KeyboardEvent('keydown', eventInit));
            target.dispatchEvent(new KeyboardEvent('keypress', eventInit));
            target.dispatchEvent(new KeyboardEvent('keyup', eventInit));
        }

        function clickElement(el) {
            try {
                el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, composed: true, view: window }));
                el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, composed: true, view: window }));
                el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true, view: window }));
            } catch (e) {
                el.click();
            }
        }

        // 1. 填充内容
        console.log("[AI Aggregator] Filling content for send...");
        const inputEl = fillInputWithText(text, true); // 发送时需要 focus
        if (!inputEl) return;

        // 针对某些需要 keydown 的框架
        // inputEl.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true })); // 移除无特定键值的 keydown

        // DeepSeek 需要直接模拟 Enter 发送
        if (host.includes('deepseek.com')) {
            await new Promise(resolve => setTimeout(resolve, 300));
            console.log("[AI Aggregator] DeepSeek detected, using Enter key to send...");
            simulateEnter(inputEl);
            return;
        }

        // 千问 (Qwen) 需要直接模拟 Enter 发送
        if (host.includes('qianwen.com') || host.includes('tongyi.aliyun.com')) {
            await new Promise(resolve => setTimeout(resolve, 300));
            console.log("[AI Aggregator] Qwen detected, using Enter key to send...");
            simulateEnter(inputEl);
            return;
        }

        // 智谱清言 (ChatGLM) 需要直接模拟 Enter 发送
        if (host.includes('chatglm.cn')) {
            await new Promise(resolve => setTimeout(resolve, 300));
            console.log("[AI Aggregator] ChatGLM detected, using Enter key to send...");
            simulateEnter(inputEl);
            return;
        }

        // 4. 等待 UI 响应（如发送按钮变亮）
        await new Promise(resolve => setTimeout(resolve, host.includes('m365.cloud.microsoft') || host.includes('github.com') ? 800 : 500));

        // 5. 定位发送按钮（按特征打分，避免选中“刷新”等非发送按钮）
        const buttonSelectors = [
            '#send_btn', // Yuanbao specific
            'a#send_btn',
            '.chat-input-send-button',
            '[class*="chat-input-send-button"]',
            '[class*="SendButton"]',
            '[data-testid*="send"]',
            'button[aria-label*="发送"]',
            'button[aria-label*="Send"]',
            'button[title*="发送"]',
            'button[title*="Send"]',
            '[role="button"][aria-label*="发送"]',
            '[role="button"][title*="发送"]',
            '.send-button',
            'button.arco-btn-primary',
            'button.ant-btn-primary',
            '[class*="send"]',
            '[id*="send"]',
            'button',
            '[role="button"]',
            '[type="submit"]'
        ];

        const candidates = [];
        const seen = new Set();
        for (const selector of buttonSelectors) {
            const btns = querySelectorAllDeep(selector);
            for (const btn of btns) {
                if (!btn || seen.has(btn)) continue;
                seen.add(btn);
                if (!isVisible(btn)) continue;
                if (btn.disabled) continue;
                
                // 排除明显的非发送按钮
                const cls = (btn.className || '').toString().toLowerCase();
                const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
                const title = (btn.getAttribute('title') || '').toLowerCase();
                const text = (btn.innerText || '').trim();

                // 如果是元宝的“智能体/插件”按钮，直接跳过
                if (host.includes('yuanbao.tencent.com')) {
                    if (aria.includes('智能体') || title.includes('智能体') || text.includes('智能体') || 
                        aria.includes('插件') || title.includes('插件') || text.includes('插件') ||
                        cls.includes('agent') || cls.includes('plugin')) {
                        continue;
                    }
                }

                if (typeof btn.className === 'string' && btn.className.toLowerCase().includes('disabled')) continue;
                if (btn.getAttribute('aria-disabled') === 'true') continue;
                
                candidates.push(btn);
            }
        }

        function scoreButton(btn) {
            const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
            const testid = (btn.getAttribute('data-testid') || '').toLowerCase();
            const title = (btn.getAttribute('title') || '').toLowerCase();
            const cls = (btn.className || '').toString().toLowerCase();
            const text = (btn.innerText || '').trim();
            const id = (btn.id || '').toLowerCase();

            let score = 0;

            // 极高分项：明确的发送标识
            if (id === 'send_btn' || id === 'sendbutton') score += 50;
            if (cls.includes('chat-input-send-button') || cls.includes('sendbutton')) score += 40;
            if (testid.includes('send') && testid.includes('button')) score += 40;
            else if (testid.includes('send')) score += 20;
            
            // 高分项：包含发送字样
            if (aria.includes('发送') || aria.includes('send')) score += 25;
            if (title.includes('发送') || title.includes('send')) score += 25;
            if (text === '发送' || text === 'Send') score += 25;
            if (text.includes('发送') || text.toLowerCase().includes('send')) score += 10;
            
            // 中分项：类名包含发送
            if (cls.includes('send-button')) score += 15;
            if (cls.includes('send')) score += 5;
            
            // 图标检查
            const hasSendIcon = btn.querySelector('img[src*="send"], img[alt*="send"], img[alt*="发送"]') || 
                               (btn.querySelector('svg') && (aria.includes('send') || aria.includes('发送') || cls.includes('send') || id.includes('send') || testid.includes('send')));
            if (hasSendIcon) score += 25;
            else if (btn.querySelector('svg')) score += 5;
            
            // 负分项：排除功能性按钮
            if (text.includes('刷新')) score -= 20;
            if (text.includes('技能') || text.includes('智能体') || text.includes('插件')) score -= 30;
            if (text.includes('深度思考')) score -= 20;
            if (aria.includes('技能') || aria.includes('智能体') || aria.includes('agent') || aria.includes('plugin')) score -= 40;
            if (title.includes('技能') || title.includes('智能体') || title.includes('agent') || title.includes('plugin')) score -= 40;
            if (aria.includes('添加') || aria.includes('上传') || aria.includes('plus') || aria.includes('more') || aria.includes('更多')) score -= 30;
            if (cls.includes('agent') || cls.includes('plugin') || cls.includes('plus') || cls.includes('more')) score -= 30;
            if (id.includes('agent') || id.includes('plugin')) score -= 30;
            // 语音/麦克风按钮（M365 常见）：避免误点
            if (aria.includes('microphone') || aria.includes('语音') || aria.includes('听写') || aria.includes('dictate')) score -= 60;
            if (title.includes('microphone') || title.includes('语音') || title.includes('听写') || title.includes('dictate')) score -= 60;
            
            // 状态检查
            if (btn.getAttribute('aria-haspopup') === 'true') score -= 40;
            if (btn.getAttribute('aria-expanded') === 'true') score -= 40;

            // 位置检查：发送按钮通常在右侧
            try {
                const rect = btn.getBoundingClientRect();
                const iframeWidth = window.innerWidth;
                if (rect.left > iframeWidth * 0.7) {
                    score += 15;
                } else if (rect.left < iframeWidth * 0.3) {
                    score -= 20; // 偏左的按钮大概率是功能插件按钮
                }
            } catch (e) {}

            return score;
        }

        const bestCandidate = candidates
            .map(btn => ({ btn, score: scoreButton(btn) }))
            .sort((a, b) => b.score - a.score)[0];

        const sendBtn = bestCandidate?.btn || null;

        if (sendBtn && bestCandidate.score > 0) {
            console.log("[AI Aggregator] Found send button, clicking...", sendBtn, "Score:", bestCandidate.score);
            // 再次确保输入框有焦点，防止某些框架在失去焦点时重置状态
            inputEl.focus();
            await new Promise(resolve => setTimeout(resolve, 100));
            clickElement(sendBtn);
        } else {
            console.log("[AI Aggregator] Send button not found or low score, trying Enter key...");
            inputEl.focus();
            await new Promise(resolve => setTimeout(resolve, 100));
            simulateEnter(inputEl);
        }
    }

    // 新对话功能
    async function handleNewConversation() {
        const host = window.location.host;
        console.log("[AI Aggregator] Starting new conversation on:", host);

        function clickElement(el) {
            try {
                el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, composed: true, view: window }));
                el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, composed: true, view: window }));
                el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true, view: window }));
            } catch (e) {
                el.click();
            }
        }

        // 各AI网站的"新对话"按钮选择器
        const newChatSelectors = [
            // 豆包
            '[class*="new-chat"]',
            '[class*="NewChat"]',
            '[class*="newchat"]',
            'button[aria-label*="新对话"]',
            'button[aria-label*="新建"]',
            // DeepSeek
            '[class*="new_chat"]',
            'div[class*="dc9d"] > div:first-child', // DeepSeek 侧边栏新对话
            // 元宝
            '[class*="new-session"]',
            'a[href*="/chat/new"]',
            // 千问
            '[class*="new-conversation"]',
            // 智谱清言
            '[class*="create-chat"]',
            // Kimi
            '[class*="new-thread"]',
            // 通用选择器
            'button[title*="新对话"]',
            'button[title*="新建对话"]',
            'button[title*="新建会话"]',
            '[data-testid*="new-chat"]',
            '[data-testid*="new-conversation"]',
            // 通用图标按钮（通常是+号或编辑图标）
            '[class*="sidebar"] button:first-child',
            '[class*="Sidebar"] button:first-child',
        ];

        let newChatBtn = null;

        for (const selector of newChatSelectors) {
            try {
                const el = document.querySelector(selector);
                if (el && el.offsetParent !== null) {
                    const text = (el.innerText || '').toLowerCase();
                    const aria = (el.getAttribute('aria-label') || '').toLowerCase();
                    const title = (el.getAttribute('title') || '').toLowerCase();
                    
                    // 验证是否是新对话相关按钮
                    if (text.includes('新') || text.includes('new') || 
                        aria.includes('新') || aria.includes('new') ||
                        title.includes('新') || title.includes('new') ||
                        selector.includes('new') || selector.includes('New')) {
                        newChatBtn = el;
                        break;
                    }
                    
                    // 如果选择器明确包含new-chat等关键词，直接使用
                    if (selector.includes('new-chat') || selector.includes('new_chat') || 
                        selector.includes('NewChat') || selector.includes('new-conversation')) {
                        newChatBtn = el;
                        break;
                    }
                }
            } catch (e) {
                // 忽略无效选择器
            }
        }

        // 特殊处理：如果通用选择器没找到，尝试通过文本内容查找
        if (!newChatBtn) {
            const allButtons = document.querySelectorAll('button, [role="button"], a');
            for (const btn of allButtons) {
                if (btn.offsetParent === null) continue;
                const text = (btn.innerText || '').trim();
                const aria = (btn.getAttribute('aria-label') || '');
                const title = (btn.getAttribute('title') || '');
                
                if (text === '新对话' || text === '新建对话' || text === '新会话' ||
                    text === 'New Chat' || text === 'New Conversation' ||
                    aria.includes('新对话') || aria.includes('新建') ||
                    title.includes('新对话') || title.includes('新建')) {
                    newChatBtn = btn;
                    break;
                }
            }
        }

        if (newChatBtn) {
            console.log("[AI Aggregator] Found new chat button, clicking...", newChatBtn);
            clickElement(newChatBtn);
        } else {
            console.log("[AI Aggregator] New chat button not found on", host);
            // 尝试通过URL导航到新对话
            if (host.includes('doubao.com')) {
                window.location.href = 'https://www.doubao.com/chat/';
            } else if (host.includes('deepseek.com')) {
                window.location.href = 'https://chat.deepseek.com/';
            } else if (host.includes('yuanbao.tencent.com')) {
                window.location.href = 'https://yuanbao.tencent.com/chat';
            } else if (host.includes('qianwen.com') || host.includes('tongyi.aliyun.com')) {
                window.location.href = 'https://www.qianwen.com/';
            } else if (host.includes('chatglm.cn')) {
                window.location.href = 'https://chatglm.cn/main/alltoolsdetail';
            } else if (host.includes('kimi.com')) {
                window.location.href = 'https://kimi.moonshot.cn/';
            } else if (host.includes('m365.cloud.microsoft')) {
                window.location.href = 'https://m365.cloud.microsoft/chat';
            } else if (host.includes('github.com')) {
                window.location.href = 'https://github.com/copilot';
            }
        }
    }
})();
