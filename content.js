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
        }
    });

    async function handleSendMessage(text) {
        const host = window.location.host;
        let inputEl = null;
        let sendBtn = null;

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
            console.error("[AI Aggregator] Could not find input element on", host);
            return;
        }

        // 2. 填充内容
        console.log("[AI Aggregator] Found input element, filling content...");
        inputEl.focus();
        
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
            inputEl.focus();
            // 尝试使用 execCommand，这是最接近真实用户输入的方式
            if (!document.execCommand('insertText', false, text)) {
                // 如果 execCommand 失败，回退到 innerText
                inputEl.innerText = text;
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

        // 针对某些需要 keydown 的框架
        inputEl.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));

        // 千问经常依赖 Enter 发送（有些 UI 不会响应单纯 click()）
        if (host.includes('qianwen.com')) {
            simulateEnter(inputEl);
        }

        // 4. 等待 UI 响应（如发送按钮变亮）
        await new Promise(resolve => setTimeout(resolve, 500));

        // 5. 定位发送按钮（按特征打分，避免选中“刷新”等非发送按钮）
        const buttonSelectors = [
            '#send_btn', // Yuanbao specific
            'a#send_btn',
            'button[data-testid*="send"]',
            'button[aria-label*="发送"]',
            'button[aria-label*="Send"]',
            '.send-button',
            'button.arco-btn-primary',
            'button.ant-btn-primary',
            '[role="button"][aria-label*="发送"]',
            'button'
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
                // Check for class-based disabled state (common in <a> tags or custom buttons)
                if (typeof btn.className === 'string' && btn.className.toLowerCase().includes('disabled')) continue;
                if (btn.getAttribute('aria-disabled') === 'true') continue;
                
                candidates.push(btn);
            }
        }

        function scoreButton(btn) {
            const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
            const testid = (btn.getAttribute('data-testid') || '').toLowerCase();
            const cls = (btn.className || '').toString().toLowerCase();
            const text = (btn.innerText || '').trim();
            const id = (btn.id || '').toLowerCase();

            let score = 0;

            if (id === 'send_btn') score += 20; // Yuanbao
            if (testid.includes('send')) score += 10;
            if (aria.includes('发送') || aria.includes('send')) score += 10;
            if (cls.includes('send')) score += 4;
            if (text === '发送' || text === 'Send') score += 12;
            if (text.includes('发送') || text.toLowerCase().includes('send')) score += 6;
            if (btn.querySelector('svg') || btn.querySelector('img[src*="send"], img[alt*="send"], img[alt*="发送"]')) score += 2;
            
            if (text.includes('刷新')) score -= 8;
            if (text.includes('技能')) score -= 10;
            if (text.includes('深度思考')) score -= 10;
            if (aria.includes('技能')) score -= 10;

            return score;
        }

        sendBtn = candidates
            .map(btn => ({ btn, score: scoreButton(btn) }))
            .sort((a, b) => b.score - a.score)[0]?.btn || null;

        if (sendBtn) {
            console.log("[AI Aggregator] Found send button, clicking...");
            clickElement(sendBtn);
        } else {
            console.log("[AI Aggregator] Send button not found or disabled, trying Enter key...");
            simulateEnter(inputEl);
        }
    }
})();
