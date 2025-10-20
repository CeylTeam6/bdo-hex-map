// Firebase and canvas setup
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.9.0/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/11.9.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  getDocs,
  collection,
  addDoc,
  deleteDoc,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/11.9.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBlPghrv_E1KU-NOVysGKgPjkceGnKSQjQ",
  authDomain: "bdohexmap.firebaseapp.com",
  projectId: "bdohexmap",
  storageBucket: "bdohexmap.appspot.com",
  messagingSenderId: "196874353655",
  appId: "1:196874353655:web:b8dd232f20238b3febccf2",
  measurementId: "G-KHZS1LRC97"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

/* ------------------------ STATE ------------------------ */
let isAdmin = false;
let hoveredHexKey = null;
let currentView = "hex"; // 'hex' | 'adventure' | 'business'
let currentOrderType = null;
let adventureRanks = { S: [], A: [], B: [], C: [], D: [], E: [] };

const REFERENCE_WIDTH = 2560;
const REFERENCE_HEIGHT = 1440;
const gridCols = 25;
const gridRows = 14;

/* ------------------------ LAYOUT HELPERS ------------------------ */
function getHexLayout() {
  const screenW = window.innerWidth;
  const screenH = window.innerHeight;
  const hexWidth = screenW / (gridCols + 0.5);
  const hexHeight = screenH / ((gridRows - 1) * 0.75 + 1);
  const hexSize = Math.min(hexWidth / Math.sqrt(3), hexHeight / 1.5);
  const pixelWidth = hexSize * Math.sqrt(3) * (gridCols + 0.5);
  const pixelHeight = hexSize * 1.5 * (gridRows - 1) + hexSize * 2;
  const offsetX = (screenW - pixelWidth) / 2 + hexSize;
  const offsetY = (screenH - pixelHeight) / 2 + hexSize;
  return { hexSize, offsetX, offsetY };
}

/* ------------------------ AUTH / UI INIT ------------------------ */
onAuthStateChanged(auth, user => {
  isAdmin = !!user;
  document.getElementById("adminChat").style.display = isAdmin ? "block" : "none";
  document.getElementById("loginBox").style.display = "block";
  refreshViewVisibility();
  updateRankUI();
  if (isAdmin) loadOrders();

  // Show who is logged in (helps verify admin is active)
  const who = document.getElementById("loginBox");
  if (who) {
    let badge = document.getElementById("whoami");
    if (!badge) {
      badge = document.createElement("div");
      badge.id = "whoami";
      badge.style.marginTop = "6px";
      who.appendChild(badge);
    }
    badge.textContent = isAdmin ? `Signed in: ${user.email || user.uid}` : "Not signed in";
  }
});

window.login = () => {
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;
  signInWithEmailAndPassword(auth, email, password)
    .then(() => alert("Logged in!"))
    .catch(err => alert("Login error: " + err.message));
};

window.logout = () => {
  signOut(auth);
  alert("Logged out.");
};

/* ------------------------ DROPDOWN SWITCHER ------------------------ */
const boardSelect = document.getElementById("boardSelect");
boardSelect.addEventListener("change", () => {
  currentView = boardSelect.value;
  // Reset transient UI
  const tip = document.getElementById("tooltip");
  const lpanel = document.getElementById("lordPanel");
  const advTip = document.getElementById("advTooltip");
  if (tip) tip.style.display = "none";
  if (lpanel) lpanel.style.display = "none";
  if (advTip) advTip.style.display = "none";

  refreshViewVisibility();
  if (currentView === "adventure") {
    loadAdventureGrid().then(() => renderAdventureGrid());
  } else if (currentView === "hex") {
    render();
  } else if (currentView === "business") {
    renderBusinesses();
  }
});

function refreshViewVisibility() {
  const inAdventureView = currentView === "adventure";
  const inHexView = currentView === "hex";
  const inBusinessView = currentView === "business";

  document.getElementById("hexCanvasContainer").style.display = inHexView ? "block" : "none";
  document.getElementById("adventureCanvasContainer").style.display = inAdventureView ? "block" : "none";
  document.getElementById("businessContainer").style.display = inBusinessView ? "block" : "none";

  document.getElementById("hexButtons").style.display = inHexView ? "flex" : "none";
  document.getElementById("adventureButtons").style.display = inAdventureView ? "flex" : "none";
  document.getElementById("businessButtons").style.display = inBusinessView ? "flex" : "none";

  document.getElementById("assignRanks").style.display = inAdventureView ? "block" : "none";
  document.getElementById("effectBtn").style.display = isAdmin && inHexView ? "block" : "none";
  document.getElementById("clearEffectsBtn").style.display = isAdmin && inHexView ? "block" : "none";
  document.getElementById("bulkBtn").style.display = isAdmin && inHexView ? "block" : "none";
  document.getElementById("dashboardBtn").style.display = inHexView ? "block" : "none";

  resizeCanvas();
}

/* ------------------------ ORDERS / REGISTRATION (Hex) ------------------------ */
window.submitOrder = (type) => {
  currentOrderType = type;
  document.getElementById("orderPrompt").style.display = "block";
};
window.confirmOrder = async () => {
  const house = document.getElementById("nobleHouseInput").value;
  const target = document.getElementById("targetInput").value;
  let emoji;
  switch (currentOrderType) {
    case "attack": emoji = "⚔️"; break;
    case "defense": emoji = "🛡️"; break;
    case "economy": emoji = "📈"; break;
    case "spy": emoji = "🕵️"; break;
    case "sabotage": emoji = "💣"; break;
    case "diplomacy": emoji = "🕊️"; break;
    default: emoji = "❔";
  }
  const message = `${emoji} ${house} issues a ${currentOrderType.toUpperCase()} order targeting ${target}`;
  await addDoc(collection(db, "orders"), { type: currentOrderType, house, target, message, timestamp: Date.now() });
  document.getElementById("orderPrompt").style.display = "none";
  document.getElementById("nobleHouseInput").value = "";
  document.getElementById("targetInput").value = "";
  if (isAdmin) loadOrders();
};
window.cancelOrder = () => document.getElementById("orderPrompt").style.display = "none";

window.registerNobleHouse = () => document.getElementById("registerPrompt").style.display = "block";
window.confirmRegistration = async () => {
  const family = document.getElementById("familyNameInput").value;
  const domain = document.getElementById("domainInput").value;
  const heraldry = document.getElementById("heraldryInput").value;
  const message = `🏰 Noble House Registered:\nFamily: ${family}\nDomain: ${domain}\nHeraldry: ${heraldry}`;
  await addDoc(collection(db, "orders"), { type: "registration", house: family, target: domain, family, domain, heraldry, message, timestamp: Date.now() });
  document.getElementById("registerPrompt").style.display = "none";
  document.getElementById("familyNameInput").value = "";
  document.getElementById("domainInput").value = "";
  document.getElementById("heraldryInput").value = "";
  if (isAdmin) loadOrders();
};
window.cancelRegistration = () => document.getElementById("registerPrompt").style.display = "none";

/* ------------------------ ADMIN LOG ------------------------ */
let highlightedOrders = [];
const hexGrid = {};
let hexEffects = {}; // { "q,r": true }

function syncHexEffectsWithGrid() {
  hexEffects = {};
  Object.entries(hexGrid).forEach(([key, tile]) => { if (tile.effect) hexEffects[key] = true; });
}
function highlightOrderTargets(orderData) {
  clearOrderHighlights();
  const keys = Object.keys(hexGrid);
  const targetMatch = keys.find(k => hexGrid[k].title && hexGrid[k].title.toLowerCase().includes(orderData.target ? orderData.target.toLowerCase() : ''));
  if (targetMatch) {
    const hex = hexGrid[targetMatch];
    highlightedOrders.push({ key: targetMatch, originalColor: hex.color });
    hex.color = "rgba(255, 0, 0, 0.5)";
  }
  render();
}
function clearOrderHighlights() {
  highlightedOrders.forEach(({ key, originalColor }) => { if (hexGrid[key]) hexGrid[key].color = originalColor; });
  highlightedOrders = [];
  render();
}
window.loadOrders = async () => {
  const list = document.getElementById("orderList");
  list.innerHTML = "";
  const querySnapshot = await getDocs(collection(db, "orders"));
  querySnapshot.forEach(docSnap => {
    const data = docSnap.data();
    const li = document.createElement("li");
    li.textContent = `[${data.type}] ${data.message || `${data.house} -> ${data.target}`}`;
    li.style.cursor = "pointer";
    li.onclick = () => highlightOrderTargets(data);
    list.appendChild(li);
  });
};
window.clearOrders = async () => {
  const querySnapshot = await getDocs(collection(db, "orders"));
  querySnapshot.forEach(async docSnap => { await deleteDoc(doc(db, "orders", docSnap.id)); });
  document.getElementById("orderList").innerHTML = "";
};

/* ------------------------ ADMIN & DASHBOARD (Hex) ------------------------ */
let effectMode = false;
let bulkMode = false;
let selectedHexes = [];
let bulkRect = null;
let bulkStart = null;

window.openDashboard = async function() {
  document.getElementById("dashboardModal").style.display = "block";
  let houses = {};
  Object.values(hexGrid).forEach(hex => {
    if (hex.lord && hex.lord.trim()) {
      if (!houses[hex.lord]) houses[hex.lord] = { count: 0, domains: [], heraldry: "", info: "" };
      houses[hex.lord].count++;
      if (hex.title && hex.title.trim()) houses[hex.lord].domains.push(hex.title);
      if (hex.heraldry) houses[hex.lord].heraldry = hex.heraldry;
      if (hex.lordInfo) houses[hex.lord].info = hex.lordInfo;
    }
  });
  let html = Object.entries(houses).map(([lord, data]) => `
    <div style="border-bottom:1px solid #ccc; margin-bottom:12px; padding-bottom:9px;">
      <div style="font-weight:bold;">${lord}</div>
      <div style="margin-left:10px;">
        Domains: <span style="color:#888;">${data.domains.join(", ") || "None"}</span><br>
        Territories: <b>${data.count}</b>
        ${data.heraldry ? `<br>Heraldry: <img src="${data.heraldry}" style="height:32px;vertical-align:middle;">` : ""}
        ${data.info ? `<br><i>${data.info}</i>` : ""}
      </div>
    </div>
  `).join("");
  if (!html) html = "<i>No houses have been assigned to tiles yet.</i>";
  document.getElementById("dashboardContent").innerHTML = html;
};
window.closeDashboard = () => document.getElementById("dashboardModal").style.display = "none";

window.toggleEffectMode = function() {
  if (!isAdmin) return;
  effectMode = !effectMode;
  bulkMode = false;
  document.getElementById("effectBtn").style.background = effectMode ? "#ffd77a" : "";
  document.getElementById("bulkBtn").style.background = "";
  if (effectMode && Object.keys(hexEffects).length > 0) requestAnimationFrame(render);
};
window.clearAllHexEffects = async function() {
  if (!isAdmin) return;
  if (confirm("Clear all glowing hex effects?")) {
    for (let key in hexGrid) {
      if (hexGrid[key].effect) {
        hexGrid[key].effect = false;
        await setDoc(doc(db, "hexTiles", key), hexGrid[key]);
      }
    }
    syncHexEffectsWithGrid();
    render();
  }
};

window.toggleBulkMode = function() {
  if (!isAdmin) return;
  bulkMode = !bulkMode;
  effectMode = false;
  document.getElementById("bulkBtn").style.background = bulkMode ? "#ffd77a" : "";
  document.getElementById("effectBtn").style.background = "";
  selectedHexes = [];
  bulkRect = null;
  render();
};

function showBulkModal() { document.getElementById("bulkModal").style.display = "block"; }
window.closeBulkModal = function() {
  document.getElementById("bulkModal").style.display = "none";
  selectedHexes = [];
  bulkRect = null;
  render();
};
window.bulkAssignHouse = async function() {
  let lord = prompt("Enter Lord/House name for selected hexes:");
  if (lord) {
    for (let key of selectedHexes) {
      let h = hexGrid[key];
      h.lord = lord;
      await setDoc(doc(db, "hexTiles", key), h);
    }
    await loadGrid();
    closeBulkModal();
  }
};
window.bulkColor = async function() {
  let color = prompt("Enter color (e.g. rgba(0,255,0,0.5)) for selected hexes:");
  if (color) {
    for (let key of selectedHexes) {
      let h = hexGrid[key];
      h.color = color;
      await setDoc(doc(db, "hexTiles", key), h);
    }
    await loadGrid();
    closeBulkModal();
  }
};
window.bulkClear = async function() {
  if (confirm("Clear ALL selected hexes?")) {
    for (let key of selectedHexes) {
      let { q, r } = hexGrid[key];
      let h = { q, r, color: "rgba(0,0,0,0)", title: "", info: "", image: "", lord: "", lordInfo: "", lordVideo: "", effect: false };
      await setDoc(doc(db, "hexTiles", key), h);
      hexGrid[key] = h;
    }
    await loadGrid();
    closeBulkModal();
  }
};

/* ------------------------ HEX MAP LOGIC ------------------------ */
const canvas = document.getElementById("hexMap");
const ctx = canvas.getContext("2d");
const background = new Image();
background.src = "BDOMAP.jpg?v=" + Date.now();

const tooltip = document.getElementById("tooltip");
const lordPanel = document.getElementById("lordPanel");
const lordName = document.getElementById("lordName");
const lordInfo = document.getElementById("lordInfo");
const lordVideo = document.getElementById("lordVideo");

function hexToPixel(q, r) {
  const { hexSize, offsetX, offsetY } = getHexLayout();
  const x = hexSize * Math.sqrt(3) * (q + r / 2) + offsetX;
  const y = hexSize * 1.5 * r + offsetY;
  return { x, y };
}

function pixelToHex(x, y) {
  const { hexSize, offsetX, offsetY } = getHexLayout();
  x -= offsetX;
  y -= offsetY;
  const q = ((Math.sqrt(3) / 3 * x) - (1 / 3 * y)) / hexSize;
  const r = (2 / 3 * y) / hexSize;
  return hexRound(q, r);
}

function hexRound(q, r) {
  let x = q, z = r, y = -x - z;
  let rx = Math.round(x), ry = Math.round(y), rz = Math.round(z);
  const x_diff = Math.abs(rx - x), y_diff = Math.abs(ry - y), z_diff = Math.abs(rz - z);
  if (x_diff > y_diff && x_diff > z_diff) rx = -ry - rz;
  else if (y_diff > z_diff) ry = -rx - rz;
  else rz = -rx - ry;
  return { q: rx, r: rz };
}

function render(timestamp = 0) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(background, 0, 0, canvas.width, canvas.height);

  const t = ((timestamp || performance.now()) / 900) % 2;
  const phase = t < 1 ? t : 2 - t;
  Object.entries(hexGrid).forEach(([key, { q, r, color, effect }]) => {
    const { x, y } = hexToPixel(q, r);
    let isEffect = !!effect;
    let isSelected = selectedHexes.includes(key);
    let effectAlpha = isEffect ? 0.45 + 0.55 * phase : 0;
    drawHex(x, y, color, key, key === hoveredHexKey, isEffect, isSelected, effectAlpha);
  });
  if (bulkRect) {
    ctx.save();
    ctx.strokeStyle = "#22fffd";
    ctx.lineWidth = 3.5;
    ctx.setLineDash([8, 10]);
    ctx.strokeRect(bulkRect.x1, bulkRect.y1, bulkRect.x2-bulkRect.x1, bulkRect.y2-bulkRect.y1);
    ctx.setLineDash([]);
    ctx.restore();
  }
  if (Object.keys(hexEffects).length > 0) requestAnimationFrame(render);
}

function drawHex(x, y, color = "rgba(0,0,0,0)", label = "", isHovered = false, isEffect = false, isSelected = false, effectAlpha = 1) {
  const { hexSize } = getHexLayout();
  ctx.save();
  if (isEffect && effectAlpha > 0) {
    ctx.shadowColor = "#ffd77a";
    ctx.shadowBlur = 32 + 24 * effectAlpha;
    ctx.globalAlpha = effectAlpha;
  }
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const angle = Math.PI / 180 * (60 * i + 30);
    const px = x + hexSize * Math.cos(angle);
    const py = y + hexSize * Math.sin(angle);
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.strokeStyle = isHovered ? "yellow" : (isSelected ? "#5dff7a" : "rgba(0,0,0,0.7)");
  ctx.lineWidth = isHovered ? 4 : (isSelected ? 6 : 2);
  ctx.stroke();
  if (color !== "rgba(0,0,0,0)") { ctx.fillStyle = color; ctx.fill(); }
  ctx.shadowBlur = 0; ctx.globalAlpha = 1;
  if (label) {
    ctx.fillStyle = "#000";
    ctx.font = "bold 16px 'Cinzel', serif";
    ctx.textAlign = "center";
    ctx.fillText(label, x, y + 5);
  }
  ctx.restore();
}

canvas.addEventListener("click", async (e) => {
  if (!isAdmin) return alert("You must be logged in to edit.");
  const rect = canvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;
  const { q, r } = pixelToHex(mouseX, mouseY);
  const key = `${q},${r}`;
  let data = hexGrid[key] || { q, r, color: "rgba(0,0,0,0)", title: "Untitled", info: "", image: "", lord: "", lordInfo: "", lordVideo: "", effect: false };

  if (window.clearHexMode) {
    await setDoc(doc(db, "hexTiles", key), { q, r, color: "rgba(0,0,0,0)", title: "", info: "", image: "", lord: "", lordInfo: "", lordVideo: "", effect: false });
    hexGrid[key] = { q, r, color: "rgba(0,0,0,0)", title: "", info: "", image: "", lord: "", lordInfo: "", lordVideo: "", effect: false };
    syncHexEffectsWithGrid();
    window.clearHexMode = false;
    render(); return;
  }

  if (effectMode && isAdmin) {
    data.effect = !!data.effect ? false : true;
    hexGrid[key] = data;
    await setDoc(doc(db, "hexTiles", key), data);
    syncHexEffectsWithGrid();
    if (Object.keys(hexEffects).length > 0) requestAnimationFrame(render); else render();
    return;
  }

  if (bulkMode) return;

  const title = prompt("Enter title:", data.title);
  const info = prompt("Enter description:", data.info);
  const image = prompt("Enter image URL:", data.image);
  const color = prompt("Enter hex color (e.g. rgba(0,255,0,0.5)):", data.color);
  const lord = prompt("Enter Lord's Name:", data.lord);
  const lordInfoText = prompt("Enter Lord's Info:", data.lordInfo);
  const lordVideoURL = prompt("Enter Lord's Video URL:", data.lordVideo);

  data = { q, r, title, info, image, color, lord, lordInfo: lordInfoText, lordVideo: lordVideoURL, effect: data.effect || false };
  hexGrid[key] = data;
  await setDoc(doc(db, "hexTiles", key), data);
  syncHexEffectsWithGrid();
  render();
});
window.clearHexTile = () => { window.clearHexMode = true; alert("Click a hex to clear it."); };

canvas.addEventListener("mousemove", (e) => {
  const rect = canvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;
  const { q, r } = pixelToHex(mouseX, mouseY);
  const key = `${q},${r}`;
  hoveredHexKey = key;
  const hex = hexGrid[key];

  if (hex && (hex.title || hex.info || hex.image)) {
    lordPanel.style.display = "block";
    lordPanel.style.left = `${e.clientX + 10}px`;
    lordPanel.style.top = `${e.clientY - 205}px`;
    lordName.textContent = hex.lord || "Unknown Lord";
    lordInfo.textContent = hex.lordInfo || "";
    lordVideo.src = hex.lordVideo || "";
    lordVideo.loop = true; lordVideo.play();

    tooltip.style.display = "block";
    tooltip.style.left = `${e.clientX + 10}px`;
    tooltip.style.top = `${e.clientY + 35}px`;
    tooltip.innerHTML = `<strong>${hex.title}</strong><br>${hex.info}` + (hex.image ? `<br><img src="${hex.image}" style="width:100px;">` : "");
  } else {
    tooltip.style.display = "none";
    lordPanel.style.display = "none";
    lordVideo.pause();
  }
  render();
});

/* Bulk select events */
canvas.addEventListener("mousedown", (e) => {
  if (!isAdmin || !bulkMode) return;
  const rect = canvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;
  bulkStart = { x: mouseX, y: mouseY };
  bulkRect = null;
});
canvas.addEventListener("mousemove", (e) => {
  if (!isAdmin || !bulkMode || !bulkStart) return;
  const rect = canvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;
  bulkRect = {
    x1: Math.min(bulkStart.x, mouseX),
    y1: Math.min(bulkStart.y, mouseY),
    x2: Math.max(bulkStart.x, mouseX),
    y2: Math.max(bulkStart.y, mouseY)
  };
  render();
});
canvas.addEventListener("mouseup", (e) => {
  if (!isAdmin || !bulkMode || !bulkStart) return;
  const rect = canvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;
  bulkRect = {
    x1: Math.min(bulkStart.x, mouseX),
    y1: Math.min(bulkStart.y, mouseY),
    x2: Math.max(bulkStart.x, mouseX),
    y2: Math.max(bulkStart.y, mouseY)
  };
  selectedHexes = [];
  for (let key in hexGrid) {
    let { q, r } = hexGrid[key];
    let { x, y } = hexToPixel(q, r);
    if (x >= bulkRect.x1 && x <= bulkRect.x2 && y >= bulkRect.y1 && y <= bulkRect.y2) selectedHexes.push(key);
  }
  bulkStart = null;
  showBulkModal();
  render();
});

async function loadGrid() {
  const snap = await getDocs(collection(db, "hexTiles"));
  snap.forEach(docSnap => {
    const data = docSnap.data();
    hexGrid[`${data.q},${data.r}`] = data;
  });
  syncHexEffectsWithGrid();
  render();
  if (Object.keys(hexEffects).length > 0) requestAnimationFrame(render);
}

/* ------------------------ ADVENTURE GRID ------------------------ */
const adventureCanvas = document.getElementById("adventureGrid");
const actx = adventureCanvas.getContext("2d");
const advBg = new Image();
advBg.src = "adventure.jpg";
let adventureGrid = {};
let advHover = null;
let adventureBgLoaded = false;
const advGridCols = 7;
const advGridRows = 7;
advBg.onload = () => { adventureBgLoaded = true; renderAdventureGrid(); };

function getAdventureGridLayout() {
  const padding = 40;
  const usableW = window.innerWidth - padding * 2;
  const usableH = window.innerHeight - padding * 2;
  const cellSize = Math.min(usableW / advGridCols, usableH / advGridRows);
  const gridWidth = cellSize * advGridCols;
  const gridHeight = cellSize * advGridRows;
  const offsetX = (window.innerWidth - gridWidth) / 2;
  const offsetY = (window.innerHeight - gridHeight) / 2;
  return { cellSize, offsetX, offsetY };
}
function renderAdventureGrid() {
  actx.clearRect(0, 0, adventureCanvas.width, adventureCanvas.height);
  if (adventureBgLoaded) actx.drawImage(advBg, 0, 0, adventureCanvas.width, adventureCanvas.height);
  else { actx.fillStyle = "#ccc"; actx.fillRect(0, 0, adventureCanvas.width, adventureCanvas.height); }
  const { cellSize, offsetX, offsetY } = getAdventureGridLayout();
  for (let r = 0; r < advGridRows; r++) {
    for (let c = 0; c < advGridCols; c++) {
      const key = `${c},${r}`;
      const cell = adventureGrid[key] || {};
      const x = offsetX + c * cellSize;
      const y = offsetY + r * cellSize;
      actx.fillStyle = cell.color || "rgba(255,255,255,0.3)";
      actx.fillRect(x, y, cellSize, cellSize);
      actx.strokeStyle = "black"; actx.lineWidth = 1.5; actx.strokeRect(x, y, cellSize, cellSize);
    }
  }
  if (advHover) {
    const { cellSize, offsetX, offsetY } = getAdventureGridLayout();
    const { c, r } = advHover;
    const x = offsetX + c * cellSize, y = offsetY + r * cellSize;
    actx.save(); actx.strokeStyle = "yellow"; actx.lineWidth = 4; actx.strokeRect(x, y, cellSize, cellSize); actx.restore();
  }
}
adventureCanvas.addEventListener("click", async (e) => {
  if (!isAdmin) return;
  const { cellSize, offsetX, offsetY } = getAdventureGridLayout();
  const rect = adventureCanvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left; const mouseY = e.clientY - rect.top;
  const c = Math.floor((mouseX - offsetX) / cellSize);
  const r = Math.floor((mouseY - offsetY) / cellSize);
  if (c < 0 || r < 0 || c >= advGridCols || r >= advGridRows) return;
  const key = `${c},${r}`;
  const existing = adventureGrid[key] || {};
  const type = prompt("Enter Mission Type:", existing.type || "");
  const details = prompt("Enter Mission Details:", existing.details || "");
  const image = prompt("Enter Image URL:", existing.image || "");
  const color = "rgba(0,255,0,0.2)";
  adventureGrid[key] = { type, details, image, color };
  await setDoc(doc(db, "adventureGrid", key), { ...adventureGrid[key], c, r });
  renderAdventureGrid();
});
window.clearAdventureTile = () => { window.clearAdventureMode = true; alert("Click an adventure box to clear it."); };
adventureCanvas.addEventListener("mousedown", async (e) => {
  if (!isAdmin || !window.clearAdventureMode) return;
  const { cellSize, offsetX, offsetY } = getAdventureGridLayout();
  const rect = adventureCanvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left; const mouseY = e.clientY - rect.top;
  const c = Math.floor((mouseX - offsetX) / cellSize); const r = Math.floor((mouseY - offsetY) / cellSize);
  if (c < 0 || r < 0 || c >= advGridCols || r >= advGridRows) return;
  const key = `${c},${r}`;
  adventureGrid[key] = {};
  await setDoc(doc(db, "adventureGrid", key), { c, r, type: "", details: "", image: "", color: "" });
  window.clearAdventureMode = false;
  renderAdventureGrid();
});
adventureCanvas.addEventListener("mousemove", (e) => {
  const { cellSize, offsetX, offsetY } = getAdventureGridLayout();
  const rect = adventureCanvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left; const mouseY = e.clientY - rect.top;
  const c = Math.floor((mouseX - offsetX) / cellSize); const r = Math.floor((mouseY - offsetY) / cellSize);
  if (c < 0 || r < 0 || c >= advGridCols || r >= advGridRows) {
    advHover = null; document.getElementById("advTooltip").style.display = "none"; renderAdventureGrid(); return;
  }
  advHover = { c, r }; renderAdventureGrid();
  const key = `${c},${r}`; const cell = adventureGrid[key];
  if (cell && (cell.type || cell.details || cell.image)) {
    const advTooltip = document.getElementById("advTooltip");
    advTooltip.style.display = "block";
    advTooltip.style.left = (e.clientX + 15) + "px";
    advTooltip.style.top = (e.clientY + 25) + "px";
    advTooltip.innerHTML =
      `<strong>${cell.type || "Unknown Mission"}</strong><br>` +
      (cell.details ? cell.details + "<br>" : "") +
      (cell.image ? `<img src="${cell.image}" style="width:90px; margin-top:5px;">` : "");
  } else document.getElementById("advTooltip").style.display = "none";
});
async function loadAdventureGrid() {
  adventureGrid = {};
  const snap = await getDocs(collection(db, "adventureGrid"));
  snap.forEach(docSnap => { const data = docSnap.data(); adventureGrid[`${data.c},${data.r}`] = data; });
}

/* ------------------------ ADVENTURE RANKS ------------------------ */
async function loadRanks() {
  const docSnap = await getDoc(doc(db, "adventureRanks", "ranks"));
  if (docSnap.exists()) { adventureRanks = docSnap.data(); updateRankUI(); }
}
async function saveRanks() { await setDoc(doc(db, "adventureRanks", "ranks"), adventureRanks); }
window.assignRank = async (rank) => {
  if (!isAdmin) return;
  const name = prompt(`Enter name for ${rank} rank:`);
  if (name) { adventureRanks[rank].push(name); await saveRanks(); updateRankUI(); }
};
window.removeRankName = async (rank) => {
  if (!isAdmin) return;
  const name = prompt(`Enter the name to remove from ${rank} rank:`);
  if (name) {
    const idx = adventureRanks[rank].findIndex(n => n.toLowerCase() === name.trim().toLowerCase());
    if (idx !== -1) { adventureRanks[rank].splice(idx, 1); await saveRanks(); updateRankUI(); alert(`Removed "${name}" from rank ${rank}.`); }
    else alert(`Name not found in rank ${rank}.`);
  }
};
window.clearAllRank = async (rank) => {
  if (!isAdmin) return;
  if (confirm(`Clear ALL names from ${rank} rank?`)) { adventureRanks[rank] = []; await saveRanks(); updateRankUI(); }
};
function updateRankUI() {
  for (const rank of ["S", "A", "B", "C", "D", "E"]) {
    const el = document.getElementById(`rank${rank}`);
    el.textContent = adventureRanks[rank] ? adventureRanks[rank].join(", ") : "";
    if (isAdmin) {
      document.getElementById(`addRank${rank}`).style.display = "inline";
      document.getElementById(`removeRank${rank}`).style.display = "inline";
      document.getElementById(`clearRank${rank}`).style.display = "inline";
    } else {
      document.getElementById(`addRank${rank}`).style.display = "none";
      document.getElementById(`removeRank${rank}`).style.display = "none";
      document.getElementById(`clearRank${rank}`).style.display = "none";
    }
  }
}

/* ------------------------ RESIZE ------------------------ */
function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  adventureCanvas.width = window.innerWidth;
  adventureCanvas.height = window.innerHeight;
  if (currentView === "hex") render();
  if (currentView === "adventure") renderAdventureGrid();
  if (Object.keys(hexEffects).length > 0) requestAnimationFrame(render);
}
window.addEventListener("resize", resizeCanvas);

/* ======================== BUSINESS BOARD ======================== */
let businesses = [];        // [{id, name, owner, description, location, hours, logoURL, inventory:[{item,price,stock}]}]
let editingBusiness = null; // obj reference while editing
let unsubscribeBusinesses = null;

// Improved error helper: only say "log in" if not logged; otherwise surface rules error.
function showAdminWriteError(err) {
  console.error(err);
  if (!auth.currentUser) {
    alert(
      "Editing the Business Board requires your admin login (the same login used on the other boards). " +
      "Please log in and try again."
    );
  } else if (err && err.code === "permission-denied") {
    alert(
      "Permission denied by Firestore rules. Your admin account is logged in, " +
      "but the rules for the Business Board don't allow this write. " +
      "Update your Firestore rules to allow logged-in admins to write to /businesses and try again."
    );
  } else {
    alert("Could not complete the action. " + (err?.message || "Unknown error"));
  }
}

async function loadBusinesses() {
  if (unsubscribeBusinesses) unsubscribeBusinesses();
  const colRef = collection(db, "businesses");
  unsubscribeBusinesses = onSnapshot(colRef, (snap) => {
    businesses = [];
    snap.forEach(docSnap => {
      const data = docSnap.data();
      businesses.push({
        id: docSnap.id,
        name: "",
        owner: "",
        description: "",
        location: "",
        hours: "",
        logoURL: "",
        inventory: [],
        ...data
      });
    });
    renderBusinesses();
  }, (err) => {
    console.error("Business snapshot error:", err);
    alert("Could not load businesses: " + err.message);
  });
}

function renderBusinesses() {
  const grid = document.getElementById("businessGrid");
  if (!grid) return;
  grid.innerHTML = "";
  if (!businesses.length) {
    grid.innerHTML = `<div style="color:#e8d8b8;opacity:.9;">No businesses registered yet. Be the first to open shop!</div>`;
    return;
  }
  businesses.forEach((biz) => {
    const card = document.createElement("div");
    card.className = "bizCard";
    card.innerHTML = `
      <div class="bizHeader">
        <img class="bizLogo" src="${biz.logoURL || ''}" onerror="this.style.display='none'">
        <div class="bizTitle">${biz.name || 'Unnamed Business'}</div>
      </div>
      <div class="bizField"><b>Owner:</b> ${biz.owner || '—'}</div>
      <div class="bizField"><b>Location:</b> ${biz.location || '—'}</div>
      <div class="bizField"><b>Hours:</b> ${biz.hours || '—'}</div>
      <div class="bizField"><b>About:</b> ${biz.description || '—'}</div>
      <div class="invHeader">📜 Inventory</div>
      <ul class="invList">
        ${(biz.inventory && biz.inventory.length) ? biz.inventory.map((it)=>`<li>${it.item} — ${it.price}${(it.stock!==undefined&&it.stock!=="")?` (x${it.stock})`:''}</li>`).join("") : `<li style="opacity:.8;">No items listed.</li>`}
      </ul>
      <div class="bizActions">
        <button onclick="openMeetingPrompt('${biz.id}')">🤝 Request Meeting</button>
        ${isAdmin ? `<button onclick="openEditBusiness('${biz.id}')">✏️ Edit</button>` : ""}
      </div>
    `;
    const invHeader = card.querySelector(".invHeader");
    const invList = card.querySelector(".invList");
    invHeader.addEventListener("click", () => {
      invList.style.display = (invList.style.display === "block") ? "none" : "block";
    });
    grid.appendChild(card);
  });
}

/* --- Register business (open to players, or require login via rules if preferred) --- */
window.openBusinessPrompt = () => {
  document.getElementById("bizNameInput").value = "";
  document.getElementById("bizOwnerInput").value = "";
  document.getElementById("bizDescInput").value = "";
  document.getElementById("bizLocInput").value = "";
  document.getElementById("bizHoursInput").value = "";
  document.getElementById("bizLogoInput").value = "";
  document.getElementById("businessPrompt").style.display = "block";
};
window.closeBusinessPrompt = () => document.getElementById("businessPrompt").style.display = "none";

window.confirmBusinessRegistration = async () => {
  const name = document.getElementById("bizNameInput").value.trim();
  const owner = document.getElementById("bizOwnerInput").value.trim();
  const description = document.getElementById("bizDescInput").value.trim();
  const location = document.getElementById("bizLocInput").value.trim();
  const hours = document.getElementById("bizHoursInput").value.trim();
  const logoURL = document.getElementById("bizLogoInput").value.trim();

  if (!name) return alert("Please enter a business name.");

  try {
    await addDoc(collection(db, "businesses"), {
      name, owner, description, location, hours, logoURL, inventory: []
    });

    // Best-effort admin log (ignore if restricted)
    try {
      await addDoc(collection(db, "orders"), {
        type: "business",
        house: owner || name,
        target: name,
        message: `🏪 Business Registered: ${name} (${owner || "Unknown Owner"})`,
        timestamp: Date.now()
      });
    } catch (_) {}

    document.getElementById("businessPrompt").style.display = "none";
    if (isAdmin) loadOrders();
  } catch (err) {
    console.error("Registration failed:", err);
    if (!auth.currentUser) {
      alert("Please log in with your admin account to edit the Business Board and try again.");
    } else if (err && err.code === "permission-denied") {
      alert(
        "Permission denied by Firestore rules for Business registration. " +
        "Update your rules so logged-in admins can create in /businesses."
      );
    } else {
      alert("Could not register the business. " + (err?.message || "Unknown error"));
    }
  }
};

/* --- Edit business (ADMIN ONLY) --- */
window.openEditBusiness = (id) => {
  if (!isAdmin) { alert("Admin login required to edit businesses."); return; }
  editingBusiness = businesses.find(b => b.id === id);
  if (!editingBusiness) return;
  document.getElementById("editBizId").value = editingBusiness.id;
  document.getElementById("editBizName").value = editingBusiness.name || "";
  document.getElementById("editBizOwner").value = editingBusiness.owner || "";
  document.getElementById("editBizDesc").value = editingBusiness.description || "";
  document.getElementById("editBizLoc").value = editingBusiness.location || "";
  document.getElementById("editBizHours").value = editingBusiness.hours || "";
  document.getElementById("editBizLogo").value = editingBusiness.logoURL || "";
  const ul = document.getElementById("invListEditor");
  ul.innerHTML = (editingBusiness.inventory && editingBusiness.inventory.length)
    ? editingBusiness.inventory.map((it, idx) => `<li>${it.item} — ${it.price} ${it.stock!==undefined&&it.stock!==""?`(x${it.stock})`:""} <button onclick="removeInventoryItem(${idx})" style="margin-left:6px;">Remove</button></li>`).join("")
    : `<li style="opacity:.8;">No items listed.</li>`;
  document.getElementById("editBusinessPrompt").style.display = "block";
};
window.closeEditBusinessPrompt = () => {
  document.getElementById("editBusinessPrompt").style.display = "none";
  editingBusiness = null;
};

window.saveBusinessEdits = async () => {
  if (!isAdmin) { alert("Admin login required to edit businesses."); return; }
  if (!editingBusiness) return;
  try {
    editingBusiness.name = document.getElementById("editBizName").value.trim();
    editingBusiness.owner = document.getElementById("editBizOwner").value.trim();
    editingBusiness.description = document.getElementById("editBizDesc").value.trim();
    editingBusiness.location = document.getElementById("editBizLoc").value.trim();
    editingBusiness.hours = document.getElementById("editBizHours").value.trim();
    editingBusiness.logoURL = document.getElementById("editBizLogo").value.trim();
    await setDoc(doc(db, "businesses", editingBusiness.id), editingBusiness);
    closeEditBusinessPrompt();
  } catch (err) { showAdminWriteError(err); }
};

window.deleteBusiness = async () => {
  if (!isAdmin) { alert("Admin login required to delete businesses."); return; }
  if (!editingBusiness) return;
  if (!confirm(`Delete ${editingBusiness.name}?`)) return;
  try {
    await deleteDoc(doc(db, "businesses", editingBusiness.id));
    closeEditBusinessPrompt();
  } catch (err) { showAdminWriteError(err); }
};

/* Inventory ops (ADMIN ONLY) */
window.addInventoryItem = async () => {
  if (!isAdmin) { alert("Admin login required to edit inventory."); return; }
  if (!editingBusiness) return;
  const item = document.getElementById("invItemName").value.trim();
  const price = document.getElementById("invItemPrice").value.trim();
  const stock = document.getElementById("invItemStock").value.trim();
  if (!item) return alert("Item name required");
  try {
    if (!editingBusiness.inventory) editingBusiness.inventory = [];
    editingBusiness.inventory.push({ item, price, stock });
    await setDoc(doc(db, "businesses", editingBusiness.id), editingBusiness);
    openEditBusiness(editingBusiness.id);
  } catch (err) { showAdminWriteError(err); }
};
window.removeInventoryItem = async (idx) => {
  if (!isAdmin) { alert("Admin login required to edit inventory."); return; }
  if (!editingBusiness) return;
  try {
    editingBusiness.inventory.splice(idx, 1);
    await setDoc(doc(db, "businesses", editingBusiness.id), editingBusiness);
    openEditBusiness(editingBusiness.id);
  } catch (err) { showAdminWriteError(err); }
};

/* --- Meeting Requests (open to players) --- */
window.openMeetingPrompt = (businessId) => {
  document.getElementById("meetBusinessId").value = businessId;
  document.getElementById("meetRequesterInput").value = "";
  document.getElementById("meetMessageInput").value = "";
  document.getElementById("meetingPrompt").style.display = "block";
};
window.openMeetingPromptGeneral = () => {
  const name = prompt("Which business would you like to meet with?");
  if (!name) return;
  const biz = businesses.find(b => (b.name||"").toLowerCase() === name.toLowerCase());
  if (!biz) return alert("Business not found. Please click 'Request Meeting' on a business card instead.");
  openMeetingPrompt(biz.id);
};
window.closeMeetingPrompt = () => document.getElementById("meetingPrompt").style.display = "none";

window.confirmMeetingRequest = async () => {
  const businessId = document.getElementById("meetBusinessId").value;
  const requester = document.getElementById("meetRequesterInput").value.trim();
  const message = document.getElementById("meetMessageInput").value.trim();
  if (!businessId || !requester || !message) return alert("Please fill out all fields.");

  try {
    await addDoc(collection(db, "meetingRequests"), {
      businessId, requester, message, timestamp: Date.now()
    });

    // Best-effort admin log
    try {
      const biz = businesses.find(b => b.id === businessId);
      const logMsg = `🤝 Meeting Request: ${requester} → ${biz ? biz.name : businessId} — "${message}"`;
      await addDoc(collection(db, "orders"), {
        type: "meeting",
        house: requester,
        target: biz ? biz.name : businessId,
        message: logMsg,
        timestamp: Date.now()
      });
    } catch (_) {}

    document.getElementById("meetingPrompt").style.display = "none";
    if (isAdmin) loadOrders();
  } catch (err) {
    console.error("Meeting request failed:", err);
    alert("Could not send meeting request. Please try again shortly.");
  }
};

/* ------------------------ INIT ------------------------ */
window.onload = async () => {
  resizeCanvas();
  await loadGrid();
  await loadAdventureGrid();
  await loadRanks();
  await loadBusinesses(); // attaches onSnapshot listener
  updateRankUI();
  renderBusinesses();
  document.getElementById("boardSelect").value = "hex";
  refreshViewVisibility();
};
