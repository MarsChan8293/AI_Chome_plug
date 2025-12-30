const input = document.getElementById('unified-input');
const sendBtn = document.getElementById('send-btn');
const newChatBtn = document.getElementById('new-chat-btn');
const aiGrid = document.getElementById('ai-grid')
const toggles = document.querySelectorAll('.ai-toggle');

// 防抖函数：150ms 延迟，平衡实时性与性能
function debounce(fn, delay) {
    let timer = null;
    return function(...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
    };
}

// 实时同步输入到各 AI 网站（仅填充，不发送）
function syncInputToAIs(text) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
            chrome.tabs.sendMessage(tabs[0].id, {
                type: 'SYNC_INPUT',
                text: text
            }).catch(() => {
                // 静默忽略错误（iframe 未加载完成等情况）
            });
        }
    });
}

const debouncedSync = debounce(syncInputToAIs, 150);

// Load saved preferences
chrome.storage.local.get(['selectedAIs', 'frameWidths'], (result) => {
    const selected = result.selectedAIs || ['doubao', 'deepseek', 'kimi']; // 默认开启三个，适配三分屏
    window.savedFrameWidths = result.frameWidths || {};
    toggles.forEach(toggle => {
        if (selected.includes(toggle.dataset.id)) {
            toggle.checked = true;
            addAIFrame(toggle.dataset.id, toggle.dataset.url, toggle.parentElement.textContent.trim());
        }
    });
});

function addAIFrame(id, url, name) {
    if (document.getElementById(`frame-container-${id}`)) return;

    const container = document.createElement('div');
    container.className = 'ai-frame';
    container.id = `frame-container-${id}`;
    
    container.innerHTML = `
        <div class="label">
            <span>${name}</span>
            <div>
                <button class="open-btn" style="font-size:10px; cursor:pointer;">新标签页打开</button>
                <button class="refresh-btn" style="font-size:10px; cursor:pointer;">刷新</button>
            </div>
        </div>
        <iframe src="${url}" id="frame-${id}"></iframe>
        <div class="resize-handle"></div>
    `;

    container.querySelector('.open-btn').onclick = () => {
        chrome.tabs.create({ url });
    };

    container.querySelector('.refresh-btn').onclick = () => {
        const iframe = container.querySelector('iframe');
        iframe.src = iframe.src;
    };

    // 添加拖拽调整宽度功能
    const resizeHandle = container.querySelector('.resize-handle');
    if (resizeHandle) {
        resizeHandle.addEventListener('mousedown', (e) => {
            e.preventDefault();
            const startX = e.clientX;
            const startWidth = container.offsetWidth;
            const containerRect = aiGrid.getBoundingClientRect();
            
            // 禁用所有 iframe 的鼠标事件，防止拖拽时被 iframe 捕获
            const allIframes = document.querySelectorAll('iframe');
            allIframes.forEach(iframe => {
                iframe.style.pointerEvents = 'none';
            });
            
            // 添加拖拽状态样式
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
            
            const onMouseMove = (e) => {
                const deltaX = e.clientX - startX;
                const newWidth = startWidth + deltaX;
                const minWidth = 300; // 最小宽度
                const maxWidth = containerRect.width - 300; // 保证其他iframe至少300px
                
                if (newWidth >= minWidth && newWidth <= maxWidth) {
                    container.style.flex = `0 0 ${newWidth}px`;
                    container.style.width = `${newWidth}px`;
                }
            };
            
            const onMouseUp = () => {
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
                
                // 恢复所有 iframe 的鼠标事件
                allIframes.forEach(iframe => {
                    iframe.style.pointerEvents = '';
                });
                
                // 恢复正常状态
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
                
                // 保存宽度偏好
                saveFrameWidths();
            };
            
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });
    }

    aiGrid.appendChild(container);
    
    // 恢复保存的宽度
    restoreFrameWidth(id, container);
}

function removeAIFrame(id) {
    const container = document.getElementById(`frame-container-${id}`);
    if (container) container.remove();
}

toggles.forEach(toggle => {
    toggle.addEventListener('change', () => {
        const id = toggle.dataset.id;
        const url = toggle.dataset.url;
        const name = toggle.parentElement.textContent.trim();

        if (toggle.checked) {
            addAIFrame(id, url, name);
        } else {
            removeAIFrame(id);
        }

        // Save preferences
        const selected = Array.from(toggles)
            .filter(t => t.checked)
            .map(t => t.dataset.id);
        chrome.storage.local.set({ selectedAIs: selected });
    });
});

function sendMessage() {
    const text = input.value.trim();
    if (!text) return;

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
            chrome.tabs.sendMessage(tabs[0].id, {
                type: 'SEND_AI_MESSAGE',
                text: text
            });
        }
    });

    input.value = '';
    input.focus();
}

sendBtn.addEventListener('click', sendMessage);

// 新对话功能
function newConversation() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
            chrome.tabs.sendMessage(tabs[0].id, {
                type: 'NEW_CONVERSATION'
            });
        }
    });
}

newChatBtn.addEventListener('click', newConversation);

// 跟踪输入法组合状态（中文输入时按回车确认拼音，不应触发发送）
let isComposing = false;
input.addEventListener('compositionstart', () => {
    isComposing = true;
});
input.addEventListener('compositionend', () => {
    isComposing = false;
    // 中文输入完成后立即同步
    debouncedSync(input.value);
});

// 实时同步输入到各 AI 网站
input.addEventListener('input', () => {
    if (isComposing) return; // 中文输入法 composition 期间不同步
    debouncedSync(input.value);
});

input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !isComposing) {
        e.preventDefault();
        sendMessage();
    }
});

// 保存所有iframe的宽度偏好
function saveFrameWidths() {
    const frames = document.querySelectorAll('.ai-frame');
    const widths = {};
    frames.forEach(frame => {
        const id = frame.id.replace('frame-container-', '');
        widths[id] = frame.style.width || '';
    });
    chrome.storage.local.set({ frameWidths: widths });
}

// 恢复iframe的宽度
function restoreFrameWidth(id, container) {
    if (window.savedFrameWidths && window.savedFrameWidths[id]) {
        const savedWidth = window.savedFrameWidths[id];
        if (savedWidth) {
            container.style.flex = `0 0 ${savedWidth}`;
            container.style.width = savedWidth;
        }
    }
}
