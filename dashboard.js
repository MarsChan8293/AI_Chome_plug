const input = document.getElementById('unified-input');
const sendBtn = document.getElementById('send-btn');
const aiGrid = document.getElementById('ai-grid');
const toggles = document.querySelectorAll('.ai-toggle');

// Load saved preferences
chrome.storage.local.get(['selectedAIs'], (result) => {
    const selected = result.selectedAIs || ['doubao', 'deepseek', 'kimi']; // 默认开启三个，适配三分屏
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
    `;

    container.querySelector('.open-btn').onclick = () => {
        chrome.tabs.create({ url });
    };

    container.querySelector('.refresh-btn').onclick = () => {
        const iframe = container.querySelector('iframe');
        iframe.src = iframe.src;
    };

    aiGrid.appendChild(container);
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
            const checkedCount = Array.from(toggles).filter(t => t.checked).length;
            if (checkedCount > 3) {
                toggle.checked = false;
                alert('最多只能选择 3 个 AI 模型');
                return;
            }
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

let syncTimeout;
input.addEventListener('input', () => {
    const text = input.value;
    clearTimeout(syncTimeout);
    syncTimeout = setTimeout(() => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]) {
                chrome.tabs.sendMessage(tabs[0].id, {
                    type: 'SYNC_AI_INPUT',
                    text: text
                });
            }
        });
    }, 150);
});

input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});
