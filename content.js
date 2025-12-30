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
        } else if (request.type === 'SYNC_AI_INPUT') {
            handleSyncInput(request.text);
        }
    });

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

    async function fillInput(text, shouldFocus = false) {
        const host = window.location.host;
        let inputEl = null;

        // 1. 定位输入框
        const inputSelectors = [
            'textarea#chat-input',
            'textarea[placeholder*="问"]',
            'textarea[placeholder*="Ask"]',
            'textarea[placeholder*="输入"]',
            'div[contenteditable="true"]',
            'textarea',
            '.chat-input',
            '[role="textbox"]'
        ];

        for (const selector of inputSelectors) {
            const el = document.querySelector(selector);
            if (el && el.offsetParent !== null) { // 确保元素可见
                inputEl = el;
                break;
            }
        }

        if (!inputEl) {
            // console.error("[AI Aggregator] Could not find input element on", host);
            return null;
        }

        // 2. 填充内容（同步时不 focus，避免抢夺焦点）
        if (shouldFocus) {
            inputEl.focus();
        }
        
        if (inputEl.tagName === 'TEXTAREA' || inputEl.tagName === 'INPUT') {
            // React 16+ hack to trigger onChange
            const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
            if (nativeInputValueSetter) {
                nativeInputValueSetter.call(inputEl, text);
            } else {
                inputEl.value = text;
            }
        } else {
            // 针对 contenteditable 的特殊处理 (如 Kimi, 元宝)
            // 使用 textContent 替代 innerText，更可靠
            inputEl.textContent = text;
            
            // 如果有子节点（如 <p> 标签），也设置其内容
            const firstChild = inputEl.querySelector('p, span, div');
            if (firstChild) {
                firstChild.textContent = text;
            }
            
            // 将光标移到末尾（如果需要 focus）
            if (shouldFocus) {
                inputEl.focus();
                try {
                    const range = document.createRange();
                    const sel = window.getSelection();
                    range.selectNodeContents(inputEl);
                    range.collapse(false);
                    sel.removeAllRanges();
                    sel.addRange(range);
                } catch (e) {}
            }
        }

        // 3. 触发一系列事件以确保框架（React/Vue）感知到输入
        try {
            inputEl.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, data: text, inputType: 'insertText' }));
        } catch (e) {
            // Some pages disallow/ignore InputEvent constructor; fallback below.
        }

        const events = ['input', 'change', 'blur', 'compositionend'];
        events.forEach(evtType => {
            inputEl.dispatchEvent(new Event(evtType, { bubbles: true, cancelable: true }));
        });
        
        return inputEl;
    }

    async function handleSyncInput(text) {
        await fillInput(text, false);  // 同步时不抢焦点
    }

    async function handleSendMessage(text) {
        const host = window.location.host;
        const inputEl = await fillInput(text, true);  // 发送时需要 focus
        
        if (!inputEl) {
            console.error("[AI Aggregator] Could not find input element on", host);
            return;
        }

        // DeepSeek 需要直接模拟 Enter 发送
        if (host.includes('deepseek.com')) {
            await new Promise(resolve => setTimeout(resolve, 300));
            console.log("[AI Aggregator] DeepSeek detected, using Enter key to send...");
            simulateEnter(inputEl);
            return;
        }

        // 4. 等待 UI 响应（如发送按钮变亮）
        await new Promise(resolve => setTimeout(resolve, 500));

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
            const btns = document.querySelectorAll(selector);
            for (const btn of btns) {
                if (!btn || seen.has(btn)) continue;
                seen.add(btn);
                if (btn.offsetParent === null) continue;
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

        sendBtn = bestCandidate?.btn || null;

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
})();
