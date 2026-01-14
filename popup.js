let allArtifacts = [];
let tenantBase = "";
let packageRegId = "";

document.addEventListener('DOMContentLoaded', async () => {
    const footer = document.getElementById('footerInfo');
    
    // 1. Ambil Tab Aktif
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab || !tab.url) {
        showError("No active tab detected.");
        return;
    }

    console.log("Current URL:", tab.url);

    // 2. Deteksi Package Name dari URL
    // Mendukung format /contentpackage/NAME atau /content/NAME
    const packageMatch = tab.url.match(/content(?:package)?\/([^/?#]+)/);
    const packageName = packageMatch ? packageMatch[1] : null;

    if (!packageName) {
        showError("Please stay on a CPI Package page (Artifacts tab).");
        console.error("URL did not match package pattern");
        return;
    }

    tenantBase = new URL(tab.url).origin;
    footer.textContent = `Package: ${packageName}`;

    try {
        // 3. Ambil Metadata Package & Token Awal
        const pkgUrl = `${tenantBase}/odata/1.0/workspace.svc/ContentEntities.ContentPackages('${packageName}')?&$format=json`;
        const pkgRes = await fetch(pkgUrl, { 
            headers: { "X-Requested-With": "XMLHttpRequest", "X-CSRF-Token": "Fetch" } 
        });

        if (!pkgRes.ok) throw new Error("Package not found in Workspace");
        
        const pkgData = await pkgRes.json();
        packageRegId = pkgData.d.reg_id;

        // 4. Ambil List Artifacts
        const artUrl = `${tenantBase}/odata/1.0/workspace.svc/ContentEntities.ContentPackages('${packageName}')/Artifacts?&$format=json`;
        const artRes = await fetch(artUrl, { headers: { "X-Requested-With": "XMLHttpRequest" } });
        const artData = await artRes.json();

        const rawItems = artData?.d?.results || artData?.d || [];
        allArtifacts = rawItems.map(item => ({
            id: item.Name,
            displayName: item.DisplayName,
            type: item.Type,
            artifactRegId: item.reg_id 
        }));

        render(allArtifacts);
        footer.textContent = `Ready: ${allArtifacts.length} artifacts.`;
    } catch (err) {
        showError("Sync Error: " + err.message);
    }
});

// --- UI Logic (Search, Render, Update) ---

document.getElementById('searchInput').addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase();
    document.querySelectorAll('.item').forEach(item => {
        item.style.display = item.textContent.toLowerCase().includes(term) ? "flex" : "none";
    });
});

function render(list) {
    const listUI = document.getElementById('artifactList');
    listUI.innerHTML = list.map(item => `
        <li class="item" id="row-${item.id}">
            <input type="checkbox" class="art-cb" data-id="${item.id}">
            <div style="display:flex; flex-direction:column; margin-left: 10px;">
                <span style="font-weight:bold">${item.displayName}</span>
                <span style="font-size:9px; color:#888">${item.id}</span>
            </div>
        </li>
    `).join('');
    document.querySelectorAll('.art-cb').forEach(cb => cb.addEventListener('change', updateUI));
}

function updateUI() {
    const selected = document.querySelectorAll('.art-cb:checked').length;
    document.getElementById('deployBtn').disabled = (selected === 0);
    document.getElementById('btnText').textContent = `Deploy ${selected} Selected`;
}

document.getElementById('selectAll').addEventListener('change', (e) => {
    const visibleCbs = document.querySelectorAll('.item:not([style*="display: none"]) .art-cb');
    visibleCbs.forEach(cb => cb.checked = e.target.checked);
    updateUI();
});

// --- CORE DEPLOY LOGIC ---
document.getElementById('deployBtn').addEventListener('click', async () => {
    const selected = document.querySelectorAll('.art-cb:checked');
    const footer = document.getElementById('footerInfo');
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    document.getElementById('spinner').style.display = "inline-block";
    document.getElementById('deployBtn').disabled = true;

    for (const cb of selected) {
        const id = cb.getAttribute('data-id');
        const artifact = allArtifacts.find(a => a.id === id);
        const listItem = document.getElementById(`row-${id}`);
        
        footer.textContent = `Deploying ${id}...`;

        // deployUrl
        const deployUrl = `${tenantBase}/api/1.0/workspace/${packageRegId}/artifacts/${artifact.artifactRegId}/entities/${artifact.artifactRegId}/iflows/${id}?runtimeProfile=iflmap&webdav=DEPLOY`;

        try {
            const results = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: async (targetUrl) => {
                    try {
                        // get token
                        const tRes = await fetch(window.location.origin + "/odata/1.0/workspace.svc/$metadata", {
                            headers: { "X-CSRF-Token": "Fetch", "X-Requested-With": "XMLHttpRequest" }
                        });
                        const t = tRes.headers.get("x-csrf-token");

                        // execute
                        const r = await fetch(targetUrl, {
                            method: 'PUT',
                            headers: { 
                                "X-CSRF-Token": t,
                                "X-Requested-With": "XMLHttpRequest"
                                
                            },
                            body: "" 
                        });

                        return { ok: r.ok, status: r.status };
                    } catch (e) {
                        return { ok: false, error: e.message };
                    }
                },
                args: [deployUrl]
            });

            const res = results[0].result;
            if (res && res.ok) {
                listItem.style.background = "#e6ffed";
                listItem.style.borderLeft = "5px solid #28a745";
            } else {
                console.error(`Status ${res.status} pada ${id}`);
                listItem.style.background = "#ffeef0";
                listItem.style.borderLeft = "5px solid #d32f2f";
            }
        } catch (e) {
            console.error(e);
        }
    }

    document.getElementById('spinner').style.display = "none";
    document.getElementById('deployBtn').disabled = false;
    footer.textContent = "Finished.";
});

function showError(msg) {
    const statusDiv = document.getElementById('status');
    statusDiv.style.display = "block";
    statusDiv.textContent = msg;
}