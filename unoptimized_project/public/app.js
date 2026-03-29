const statusBadge = document.getElementById('status-badge');
const cacheSizeLabel = document.getElementById('cache-size');
const logsContainer = document.getElementById('logs');
const targetUrlInput = document.getElementById('target-url');
const pingBtn = document.getElementById('btn-ping');

const spamModeLabel = document.getElementById('spam-mode');
const spamSlider = document.getElementById('spam-slider');
const spamRateVal = document.getElementById('spam-rate');

let isConnected = false;
let spamInterval = null;
let currentUrl = targetUrlInput.value;

function addLog(message, type = 'info') {
    const el = document.createElement('div');
    el.className = `log-entry ${type}`;
    const time = new Date().toLocaleTimeString();
    el.textContent = `[${time}] ${message}`;
    logsContainer.appendChild(el);
    logsContainer.scrollTop = logsContainer.scrollHeight;
    
    // limit logs
    while(logsContainer.children.length > 50) {
        logsContainer.removeChild(logsContainer.firstChild);
    }
}

async function pingServer() {
    currentUrl = targetUrlInput.value.replace(/\/$/, "");
    try {
        statusBadge.textContent = 'CHECKING...';
        statusBadge.className = 'badge';
        const res = await fetch(`${currentUrl}/ping`);
        if(res.ok) {
            statusBadge.textContent = 'ONLINE';
            statusBadge.className = 'badge online';
            isConnected = true;
            addLog(`Successfully connected to ${currentUrl}`, 'success');
        } else {
            throw new Error('Bad status');
        }
    } catch (e) {
        statusBadge.textContent = 'ERROR';
        statusBadge.className = 'badge error';
        isConnected = false;
        addLog(`Failed to connect to ${currentUrl}`, 'error');
    }
}

pingBtn.addEventListener('click', pingServer);

async function fetchPayload(type) {
    if (!isConnected) {
        addLog(`Cannot fetch ${type}, server offline.`, 'error');
        return;
    }
    const start = performance.now();
    try {
        const res = await fetch(`${currentUrl}/${type}`);
        // Ensure we load the whole payload
        const blob = await res.blob(); 
        const end = performance.now();
        const kb = (blob.size / 1024).toFixed(2);
        const timeMs = (end - start).toFixed(0);
        addLog(`Fetched ${type} - ${kb} KB in ${timeMs}ms`, 'success');
    } catch (e) {
        addLog(`Fetch ${type} failed: ${e.message}`, 'error');
    }
}

// Track memory / cache size
setInterval(async () => {
    if(!isConnected) return;
    try {
        const res = await fetch(`${currentUrl}/stats`);
        if(res.ok) {
            const data = await res.json();
            const mb = (data.cache_bytes / (1024 * 1024)).toFixed(2);
            cacheSizeLabel.textContent = `${mb} MB`;
        }
    } catch(e) {
        // quiet fail for stats
    }
}, 1000);

// Spam mode logic
spamSlider.addEventListener('input', (e) => {
    spamRateVal.textContent = e.target.value;
    if(spamInterval) {
        startSpam();
    }
});

spamModeLabel.addEventListener('change', (e) => {
    if(e.target.checked) {
        addLog("SPAM MODE ENGAGED!", 'error');
        startSpam();
    } else {
        stopSpam();
    }
});

function getRandomPayloadType() {
    const types = ['data', 'dms', 'voice', 'image', 'video'];
    return types[Math.floor(Math.random() * types.length)];
}

function startSpam() {
    stopSpam();
    const rate = parseInt(spamSlider.value);
    const msInterval = 1000 / rate;
    
    spamInterval = setInterval(() => {
        if(isConnected) {
            fetchPayload(getRandomPayloadType());
        }
    }, msInterval);
}

function stopSpam() {
    if(spamInterval) {
        clearInterval(spamInterval);
        spamInterval = null;
        addLog("Spam mode disabled.", 'info');
    }
}
