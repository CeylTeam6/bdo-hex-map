// Firebase and canvas setup (keep your current firebase config)
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.9.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.9.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  getDocs,
  collection,
  addDoc,
  deleteDoc
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

let isAdmin = false;
let hoveredHexKey = null;

onAuthStateChanged(auth, user => {
  isAdmin = !!user;
  document.getElementById("adminChat").style.display = isAdmin ? "block" : "none";
  if (isAdmin) loadOrders();
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

// Order logic
let currentOrderType = null;

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

  await addDoc(collection(db, "orders"), {
    type: currentOrderType,
    house,
    target,
    message,
    timestamp: Date.now()
  });

  document.getElementById("orderPrompt").style.display = "none";
  document.getElementById("nobleHouseInput").value = "";
  document.getElementById("targetInput").value = "";

  if (isAdmin) loadOrders();
};

window.cancelOrder = () => {
  document.getElementById("orderPrompt").style.display = "none";
};

// Register Noble House logic
window.registerNobleHouse = () => {
  document.getElementById("registerPrompt").style.display = "block";
};

window.confirmRegistration = async () => {
  const family = document.getElementById("familyNameInput").value;
  const domain = document.getElementById("domainInput").value;
  const heraldry = document.getElementById("heraldryInput").value;
  const message = `🏰 Noble House Registered:\nFamily: ${family}\nDomain: ${domain}\nHeraldry: ${heraldry}`;

  await addDoc(collection(db, "orders"), {
    type: "registration",
    family,
    domain,
    heraldry,
    message,
    timestamp: Date.now()
  });

  document.getElementById("registerPrompt").style.display = "none";
  document.getElementById("familyNameInput").value = "";
  document.getElementById("domainInput").value = "";
  document.getElementById("heraldryInput").value = "";

  if (isAdmin) loadOrders();
};

window.cancelRegistration = () => {
  document.getElementById("registerPrompt").style.display = "none";
};

let highlightedOrders = [];

function highlightOrderTargets(orderData) {
  clearOrderHighlights();
  const keys = Object.keys(hexGrid);
  const targetMatch = keys.find(k => {
    const { title } = hexGrid[k];
    return title.toLowerCase().includes(orderData.target.toLowerCase());
  });

  if (targetMatch) {
    const hex = hexGrid[targetMatch];
    highlightedOrders.push({ key: targetMatch, originalColor: hex.color });
    hex.color = "rgba(255, 0, 0, 0.5)";
    render();
  }
}

function clearOrderHighlights() {
  highlightedOrders.forEach(({ key, originalColor }) => {
    if (hexGrid[key]) {
      hexGrid[key].color = originalColor;
    }
  });
  highlightedOrders = [];
  render();
}

window.loadOrders = async () => {
  const list = document.getElementById("orderList");
  list.innerHTML = "";
  const querySnapshot = await getDocs(collection(db, "orders"));
  querySnapshot.forEach(doc => {
    const data = doc.data();
    const li = document.createElement("li");
    li.textContent = `[${data.type}] ${data.house} -> ${data.target}`;
    li.style.cursor = "pointer";
    li.onclick = () => highlightOrderTargets(data);
    list.appendChild(li);
  });
};

window.clearOrders = async () => {
  const querySnapshot = await getDocs(collection(db, "orders"));
  querySnapshot.forEach(async docSnap => {
    await deleteDoc(doc(db, "orders", docSnap.id));
  });
  document.getElementById("orderList").innerHTML = "";
};

// Canvas & Hex logic
const canvas = document.getElementById("hexMap");
const ctx = canvas.getContext("2d");
const hexSize = 60;
const hexWidth = Math.sqrt(3) * hexSize;
const hexHeight = 2 * hexSize;
const background = new Image();
background.src = "BDOMAP.jpg?v=" + Date.now();

const tooltip = document.getElementById("tooltip");
const lordPanel = document.getElementById("lordPanel");
const lordName = document.getElementById("lordName");
const lordInfo = document.getElementById("lordInfo");
const lordVideo = document.getElementById("lordVideo");

const hexGrid = {};

function hexToPixel(q, r) {
  const x = hexSize * Math.sqrt(3) * (q + r / 2);
  const y = hexSize * 1.5 * r;
  return { x, y };
}

function pixelToHex(x, y) {
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

function drawHex(x, y, color = "rgba(0,0,0,0)", label = "", isHovered = false) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const angle = Math.PI / 180 * (60 * i + 30);
    const px = x + hexSize * Math.cos(angle);
    const py = y + hexSize * Math.sin(angle);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.strokeStyle = isHovered ? "gold" : "rgba(0,0,0,0.7)";
  ctx.lineWidth = isHovered ? 4 : 2;
  ctx.stroke();
  if (color !== "rgba(0,0,0,0)") {
    ctx.fillStyle = color;
    ctx.fill();
  }

  if (label) {
    ctx.fillStyle = "#000";
    ctx.font = "bold 16px 'Cinzel', serif";
    ctx.textAlign = "center";
    ctx.fillText(label, x, y + 5);
  }
}

function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(background, 0, 0, canvas.width, canvas.height);
  Object.entries(hexGrid).forEach(([key, { q, r, color }]) => {
    const { x, y } = hexToPixel(q, r);
    drawHex(x, y, color, key, key === hoveredHexKey);
  });
}

canvas.addEventListener("mousemove", (e) => {
  const rect = canvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;
  const { q, r } = pixelToHex(mouseX, mouseY);
  const key = `${q},${r}`;
  const hex = hexGrid[key];
  hoveredHexKey = hex ? key : null;
  render();

  if (hex) {
    tooltip.style.display = "block";
    tooltip.style.left = `${e.clientX + 10}px`;
    tooltip.style.top = `${e.clientY + 10}px`;
    tooltip.innerHTML = `<strong style="font-family: Cinzel, serif;">${hex.title}</strong><br><span style="font-family: Cinzel, serif;">${hex.info}</span>` +
      (hex.image ? `<br><img src="${hex.image}" style="width:100px;">` : "");

    lordPanel.style.display = "block";
    const panelHeight = 150;
    const topPos = e.clientY - panelHeight - 20;
    lordPanel.style.left = `${e.clientX + 10}px`;
    lordPanel.style.top = `${Math.max(0, topPos)}px`;
    lordName.textContent = hex.lord || "Unknown Lord";
    lordInfo.textContent = hex.lordInfo || "";
    lordName.style.fontFamily = lordInfo.style.fontFamily = "Cinzel, serif";
    lordVideo.src = hex.lordVideo || "";
    lordVideo.loop = true;
    lordVideo.play();
  } else {
    tooltip.style.display = "none";
    lordPanel.style.display = "none";
    lordVideo.pause();
  }
});

canvas.addEventListener("click", async (e) => {
  if (!isAdmin) return alert("You must be logged in to edit.");
  const rect = canvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;
  const { q, r } = pixelToHex(mouseX, mouseY);
  const key = `${q},${r}`;
  const data = hexGrid[key] || { q, r, color: "rgba(0,0,0,0)", title: "Untitled", info: "", image: "", lord: "", lordInfo: "", lordVideo: "" };

  const title = prompt("Enter title:", data.title);
  const info = prompt("Enter description:", data.info);
  const image = prompt("Enter image URL:", data.image);
  const color = prompt("Enter hex color (e.g. rgba(0,255,0,0.5)):", data.color);
  const lord = prompt("Enter Lord's Name:", data.lord);
  const lordInfoText = prompt("Enter Lord's Info:", data.lordInfo);
  const lordVideoURL = prompt("Enter Lord's Video URL:", data.lordVideo);

  hexGrid[key] = { q, r, title, info, image, color, lord, lordInfo: lordInfoText, lordVideo: lordVideoURL };
  await setDoc(doc(db, "hexTiles", key), hexGrid[key]);
  render();
});

async function loadGrid() {
  const snap = await getDocs(collection(db, "hexTiles"));
  snap.forEach(docSnap => {
    const data = docSnap.data();
    hexGrid[`${data.q},${data.r}`] = data;
  });
  render();
}

background.onload = () => {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  loadGrid();
};
