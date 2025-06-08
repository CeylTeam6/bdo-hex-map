import { initializeApp } from "https://www.gstatic.com/firebasejs/11.9.0/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
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
  query,
} from "https://www.gstatic.com/firebasejs/11.9.0/firebase-firestore.js";

// Firebase config
const firebaseConfig = {
  apiKey: "AIzaSyBlPghrv_E1KU-NOVysGKgPjkceGnKSQjQ",
  authDomain: "bdohexmap.firebaseapp.com",
  projectId: "bdohexmap",
  storageBucket: "bdohexmap.appspot.com",
  messagingSenderId: "196874353655",
  appId: "1:196874353655:web:b8dd232f20238b3febccf2",
  measurementId: "G-KHZS1LRC97",
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Globals
let isAdmin = false;
let currentOrderType = "";

const canvas = document.getElementById("hexMap");
const ctx = canvas.getContext("2d");

const hexSize = 60;
const hexWidth = Math.sqrt(3) * hexSize;
const hexHeight = 2 * hexSize;
const background = new Image();
background.src = "BDOMAP.jpg?v=" + Date.now();

const tooltip = document.getElementById("tooltip");
const adminChat = document.getElementById("adminChat");
const orderList = document.getElementById("orderList");

const orderPrompt = document.getElementById("orderPrompt");
const nobleHouseInput = document.getElementById("nobleHouseInput");
const targetInput = document.getElementById("targetInput");

let hexGrid = {};

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

function drawHex(x, y, color = "rgba(0,0,0,0)") {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const angle = Math.PI / 180 * (60 * i + 30);
    const px = x + hexSize * Math.cos(angle);
    const py = y + hexSize * Math.sin(angle);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.strokeStyle = "rgba(0,0,0,0.7)";
  ctx.lineWidth = 2;
  ctx.stroke();
  if (color !== "rgba(0,0,0,0)") {
    ctx.fillStyle = color;
    ctx.fill();
  }
}

function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(background, 0, 0, canvas.width, canvas.height);
  Object.values(hexGrid).forEach(({ q, r, color }) => {
    const { x, y } = hexToPixel(q, r);
    drawHex(x, y, color);
  });
}

canvas.addEventListener("click", async (e) => {
  if (!isAdmin) return alert("You must be logged in to edit.");
  const rect = canvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;
  const { q, r } = pixelToHex(mouseX, mouseY);
  const key = `${q},${r}`;
  const data = hexGrid[key] || { q, r, color: "rgba(0,0,0,0)", title: "Untitled", info: "", image: "" };

  const title = prompt("Enter title:", data.title);
  const info = prompt("Enter description:", data.info);
  const image = prompt("Enter image URL:", data.image);
  const color = prompt("Enter hex color (e.g. rgba(0,255,0,0.5)):", data.color);

  hexGrid[key] = { q, r, title, info, image, color };
  await setDoc(doc(db, "hexTiles", key), hexGrid[key]);
  render();
});

canvas.addEventListener("mousemove", (e) => {
  const rect = canvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;
  const { q, r } = pixelToHex(mouseX, mouseY);
  const key = `${q},${r}`;
  const hex = hexGrid[key];
  if (hex) {
    tooltip.style.display = "block";
    tooltip.style.left = `${e.clientX + 10}px`;
    tooltip.style.top = `${e.clientY + 10}px`;
    tooltip.innerHTML = `<strong>${hex.title}</strong><br>${hex.info}` +
      (hex.image ? `<br><img src="${hex.image}" style="width:100px;">` : "");
  } else {
    tooltip.style.display = "none";
  }
});

async function loadGrid() {
  const snap = await getDocs(collection(db, "hexTiles"));
  snap.forEach(docSnap => {
    const data = docSnap.data();
    hexGrid[`${data.q},${data.r}`] = data;
  });
  render();
}

async function loadOrders() {
  orderList.innerHTML = "";
  const snap = await getDocs(collection(db, "orders"));
  snap.forEach(docSnap => {
    const data = docSnap.data();
    const li = document.createElement("li");
    li.textContent = `[${data.type}] ${data.house} -> ${data.target}`;
    orderList.appendChild(li);
  });
}

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

onAuthStateChanged(auth, (user) => {
  isAdmin = !!user;
  if (isAdmin) {
    adminChat.style.display = "block";
    loadOrders();
  } else {
    adminChat.style.display = "none";
  }
});

background.onload = () => {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  loadGrid();
};

// Order System
window.submitOrder = (type) => {
  currentOrderType = type;
  orderPrompt.style.display = "block";
};

window.cancelOrder = () => {
  orderPrompt.style.display = "none";
};

window.confirmOrder = async () => {
  const house = nobleHouseInput.value.trim();
  const target = targetInput.value.trim();
  if (!house || !target) return alert("Fill in both fields.");
  await addDoc(collection(db, "orders"), { type: currentOrderType, house, target });
  if (isAdmin) await loadOrders();
  nobleHouseInput.value = "";
  targetInput.value = "";
  orderPrompt.style.display = "none";
};

// Admin Clear Orders
window.clearOrders = async () => {
  const snap = await getDocs(collection(db, "orders"));
  for (const docSnap of snap.docs) {
    await deleteDoc(doc(db, "orders", docSnap.id));
  }
  orderList.innerHTML = "";
};
