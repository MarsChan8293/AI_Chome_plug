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
        const events = ['input', 'change', 'blur', 'compositionend'];
        events.forEach(evtType => {
            inputEl.dispatchEvent(new Event(evtType, { bubbles: true, cancelable: true }));
        });

        // 针对某些需要 keydown 的框架
        inputEl.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));

        // 特殊处理 Minimax (minimaxi.com)
        if (host.includes('minimaxi.com')) {
            // Minimax 可能需要更强的 Enter 键模拟
            const enterEvent = new KeyboardEvent('keydown', {
                key: 'Enter',
                code: 'Enter',
                keyCode: 13,
                which: 13,
                bubbles: true,
                cancelable: true,
                composed: true
            });
            inputEl.dispatchEvent(enterEvent);
        }

        // 4. 等待 UI 响应（如发送按钮变亮）
        await new Promise(resolve => setTimeout(resolve, 500));

        // 5. 定位发送按钮
        const buttonSelectors = [
            'button[data-testid*="send"]',
            'button[aria-label*="发送"]',
            'button[aria-label*="Send"]',
            'button:has(svg)',
            'button:has(img[src*="send"])',
            '.send-button',
            'button.arco-btn-primary',
            'button.ant-btn-primary',
            '[role="button"][aria-label*="发送"]',
            'button'
        ];

        for (const selector of buttonSelectors) {
            const btns = document.querySelectorAll(selector);
            for (const btn of btns) {
                if (btn.offsetParent !== null && !btn.disabled) {
                    sendBtn = btn;
                    break;
                }
            }
            if (sendBtn) break;
        }

        if (sendBtn) {
            console.log("[AI Aggregator] Found send button, clicking...");
            sendBtn.click();
        } else {
            console.log("[AI Aggregator] Send button not found or disabled, trying Enter key...");
            const enterEvent = new KeyboardEvent('keydown', {
                key: 'Enter',
                code: 'Enter',
                keyCode: 13,
                which: 13,
                bubbles: true,
                cancelable: true,
                shiftKey: false
            });
            inputEl.dispatchEvent(enterEvent);
        }
    }
})();
