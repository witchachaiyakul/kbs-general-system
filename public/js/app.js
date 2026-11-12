import { auth, db, firebaseReady } from "./firebase.js";
import {
  Timestamp,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  where,
  writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

const rooms = [
  "หอประชุม",
  "โดมราชพฤกษ์",
  "ห้องประชุม Auditorium",
  "ห้องประชุมราชพฤกษ์",
  "ห้องทูบี",
  "ห้องสมาคมผู้ปกครองและครู",
  "ห้องประชุมช่อราชพฤกษ์"
];
const statuses = {
  "รออนุมัติ": "status-pending",
  "อนุมัติ": "status-approved",
  "ไม่อนุมัติ": "status-rejected"
};
const dateFormatter = new Intl.DateTimeFormat("th-TH", {
  timeZone: "Asia/Bangkok",
  dateStyle: "medium",
  timeStyle: "short"
});

const firebaseMessage = document.getElementById("firebase-message");
const appMessage = document.getElementById("app-message");
const componentError = document.getElementById("component-error");
let publicBookingsBody;
let adminBookingsBody;
let cachedPublicBookings = [];

function showMessage(element, message, isError) {
  element.textContent = message;
  element.classList.toggle("notice-error", Boolean(isError));
  element.hidden = false;
}

function clearMessage(element) {
  element.textContent = "";
  element.hidden = true;
}

function setBusy(button, busy, busyText) {
  if (!button.dataset.label) button.dataset.label = button.textContent;
  button.disabled = busy;
  button.textContent = busy ? busyText : button.dataset.label;
}

async function loadComponents() {
  const componentNames = ["booking", "bookings", "admin"];
  const components = await Promise.all(componentNames.map(async (name) => {
    const response = await fetch(`./components/${name}.html`);
    if (!response.ok) throw new Error(`โหลดเมนู ${name} ไม่สำเร็จ (${response.status})`);
    return response.text();
  }));
  const container = document.getElementById("component-container");
  container.replaceChildren();
  components.forEach((markup) => container.insertAdjacentHTML("beforeend", markup));
}

function timestampDate(value) {
  if (value && typeof value.toDate === "function") return value.toDate();
  return value instanceof Date ? value : new Date(value);
}

function displayDate(value) {
  const date = timestampDate(value);
  return Number.isNaN(date.getTime()) ? "-" : dateFormatter.format(date);
}

function createCell(text) {
  const cell = document.createElement("td");
  cell.textContent = text || "-";
  return cell;
}

function createStatus(status) {
  const badge = document.createElement("span");
  badge.className = `status ${statuses[status] || "status-pending"}`;
  badge.textContent = status;
  return badge;
}

function populateRoomOptions() {
  const select = document.getElementById("location");
  rooms.forEach((room) => {
    const option = document.createElement("option");
    option.value = room;
    option.textContent = room;
    select.append(option);
  });
}

function populateYearFilter() {
  const select = document.getElementById("year-filter");
  const currentYear = new Date().getFullYear();
  const allYears = document.createElement("option");
  allYears.value = "";
  allYears.textContent = "ทุกปี";
  select.append(allYears);
  for (let year = currentYear - 2; year <= currentYear + 5; year += 1) {
    const option = document.createElement("option");
    option.value = String(year);
    option.textContent = String(year + 543);
    select.append(option);
  }
  select.value = String(currentYear);
  document.getElementById("month-filter").value = String(new Date().getMonth());
}

function renderPublicBookings() {
  const month = document.getElementById("month-filter").value;
  const year = document.getElementById("year-filter").value;
  const visible = cachedPublicBookings.filter((booking) => {
    const date = timestampDate(booking.startTime);
    return (!month || date.getMonth() === Number(month)) &&
      (!year || date.getFullYear() === Number(year));
  });
  publicBookingsBody.replaceChildren();
  if (visible.length === 0) {
    const row = publicBookingsBody.insertRow();
    const cell = row.insertCell();
    cell.colSpan = 5;
    cell.className = "empty-cell";
    cell.textContent = "ไม่พบรายการจองในช่วงเวลาที่เลือก";
    return;
  }
  visible.forEach((booking) => {
    const row = publicBookingsBody.insertRow();
    row.append(
      createCell(booking.fullName),
      createCell(booking.location),
      createCell(displayDate(booking.startTime)),
      createCell(displayDate(booking.endTime))
    );
    const statusCell = row.insertCell();
    statusCell.append(createStatus(booking.status));
  });
}

async function loadPublicBookings() {
  publicBookingsBody.innerHTML = '<tr><td colspan="5" class="empty-cell">กำลังโหลดข้อมูล...</td></tr>';
  try {
    const result = await getDocs(query(
      collection(db, "publicBookings"),
      orderBy("startTime", "desc"),
      limit(100)
    ));
    cachedPublicBookings = result.docs.map((snapshot) => snapshot.data());
    renderPublicBookings();
  } catch (error) {
    showMessage(appMessage, `โหลดรายการจองไม่สำเร็จ: ${error.message}`, true);
    publicBookingsBody.innerHTML = '<tr><td colspan="5" class="empty-cell">ไม่สามารถโหลดข้อมูลได้</td></tr>';
  }
}

function getBookingFormData(form) {
  const formData = new FormData(form);
  const position = formData.get("position");
  const location = formData.get("location");
  const startTime = new Date(formData.get("startTime"));
  const endTime = new Date(formData.get("endTime"));

  if (Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime()) || endTime <= startTime) {
    throw new Error("เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่มต้น");
  }
  if (startTime <= new Date()) {
    throw new Error("กรุณาเลือกเวลาเริ่มใช้ในอนาคต");
  }
  if (!rooms.includes(location)) throw new Error("กรุณาเลือกสถานที่จากรายการ");

  return {
    fullName: String(formData.get("fullName")).trim(),
    position,
    positionOther: position === "อื่นๆ" ? String(formData.get("positionOther")).trim() : "",
    phone: String(formData.get("phone")).trim(),
    location,
    purpose: String(formData.get("purpose")).trim(),
    startTime: Timestamp.fromDate(startTime),
    endTime: Timestamp.fromDate(endTime),
    equipment: formData.getAll("equipment"),
    tables: Number(formData.get("tables") || 0),
    chairs: Number(formData.get("chairs") || 0),
    status: "รออนุมัติ"
  };
}

async function checkForRoomConflict(booking) {
  const conflicts = await getDocs(query(
    collection(db, "publicBookings"),
    where("location", "==", booking.location),
    where("startTime", "<", booking.endTime),
    orderBy("startTime", "desc"),
    limit(500)
  ));
  const start = booking.startTime.toMillis();
  return conflicts.docs.some((snapshot) => {
    const existing = snapshot.data();
    return existing.status !== "ไม่อนุมัติ" &&
      timestampDate(existing.endTime).getTime() > start;
  });
}

async function submitBooking(event) {
  event.preventDefault();
  clearMessage(appMessage);
  const form = event.currentTarget;
  const button = document.getElementById("submit-booking");
  setBusy(button, true, "กำลังบันทึก...");
  try {
    const booking = getBookingFormData(form);
    if (await checkForRoomConflict(booking)) {
      throw new Error("สถานที่มีรายการจองที่ทับซ้อนกัน กรุณาเลือกวันหรือเวลาใหม่");
    }

    const batch = writeBatch(db);
    const bookingRef = doc(collection(db, "bookings"));
    const publicBookingRef = doc(db, "publicBookings", bookingRef.id);
    const createdAt = serverTimestamp();
    batch.set(bookingRef, { ...booking, createdAt, updatedAt: createdAt });
    batch.set(publicBookingRef, {
      bookingId: bookingRef.id,
      fullName: booking.fullName,
      location: booking.location,
      startTime: booking.startTime,
      endTime: booking.endTime,
      status: booking.status,
      createdAt,
      updatedAt: createdAt
    });
    await batch.commit();
    form.reset();
    showMessage(appMessage, "ส่งคำขอจองเรียบร้อยแล้ว กรุณารอผู้ดูแลอนุมัติ", false);
    await loadPublicBookings();
  } catch (error) {
    showMessage(appMessage, `ส่งคำขอไม่สำเร็จ: ${error.message}`, true);
  } finally {
    setBusy(button, false);
  }
}

function renderAdminBookings(bookings) {
  adminBookingsBody.replaceChildren();
  if (bookings.length === 0) {
    const row = adminBookingsBody.insertRow();
    const cell = row.insertCell();
    cell.colSpan = 6;
    cell.className = "empty-cell";
    cell.textContent = "ไม่มีรายการจอง";
    return;
  }
  bookings.forEach((booking) => {
    const row = adminBookingsBody.insertRow();
    row.append(
      createCell(displayDate(booking.startTime)),
      createCell(booking.fullName),
      createCell(booking.phone),
      createCell(`${booking.location} — ${booking.purpose}`)
    );
    const statusCell = row.insertCell();
    statusCell.append(createStatus(booking.status));
    const actionCell = row.insertCell();
    actionCell.className = "action-cell";
    if (booking.status === "รออนุมัติ") {
      ["อนุมัติ", "ไม่อนุมัติ"].forEach((status) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `button ${status === "อนุมัติ" ? "button-primary" : "button-danger"}`;
        button.dataset.bookingId = booking.id;
        button.dataset.status = status;
        button.textContent = status;
        actionCell.append(button);
      });
    }
  });
}

async function loadAdminBookings() {
  adminBookingsBody.innerHTML = '<tr><td colspan="6" class="empty-cell">กำลังโหลดข้อมูล...</td></tr>';
  try {
    const result = await getDocs(query(
      collection(db, "bookings"),
      orderBy("startTime", "desc"),
      limit(200)
    ));
    renderAdminBookings(result.docs.map((snapshot) => ({ id: snapshot.id, ...snapshot.data() })));
  } catch (error) {
    showMessage(appMessage, `โหลดข้อมูลผู้ดูแลไม่สำเร็จ: ${error.message}`, true);
    adminBookingsBody.innerHTML = '<tr><td colspan="6" class="empty-cell">ไม่สามารถโหลดข้อมูลได้</td></tr>';
  }
}

async function updateBookingStatus(bookingId, status, button) {
  if (!["อนุมัติ", "ไม่อนุมัติ"].includes(status)) return;
  setBusy(button, true, "กำลังบันทึก...");
  clearMessage(appMessage);
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, "bookings", bookingId), { status, updatedAt: serverTimestamp() });
    batch.update(doc(db, "publicBookings", bookingId), { status, updatedAt: serverTimestamp() });
    await batch.commit();
    showMessage(appMessage, `เปลี่ยนสถานะเป็น "${status}" แล้ว`, false);
    await Promise.all([loadAdminBookings(), loadPublicBookings()]);
  } catch (error) {
    showMessage(appMessage, `ปรับสถานะไม่สำเร็จ: ${error.message}`, true);
    setBusy(button, false);
  }
}

function setAdminView(user) {
  document.getElementById("admin-login-view").hidden = Boolean(user);
  document.getElementById("admin-dashboard").hidden = !user;
  document.getElementById("admin-identity").textContent = user ? user.email : "";
  if (user) loadAdminBookings();
}

async function verifyAdmin(user) {
  if (!user) {
    setAdminView(null);
    return;
  }
  try {
    const userSnapshot = await getDoc(doc(db, "users", user.uid));
    if (!userSnapshot.exists() || userSnapshot.data().role !== "admin") {
      await signOut(auth);
      showMessage(appMessage, "บัญชีนี้ไม่มีสิทธิ์ผู้ดูแลระบบ", true);
      return;
    }
    setAdminView(user);
  } catch (error) {
    showMessage(appMessage, `ตรวจสอบสิทธิ์ไม่สำเร็จ: ${error.message}`, true);
    await signOut(auth);
  }
}

function bindNavigation() {
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".app-view").forEach((view) => { view.hidden = true; });
      const target = document.getElementById(button.dataset.view);
      if (!target) {
        showMessage(componentError, "ไม่พบหน้าที่เลือก กรุณาตรวจสอบไฟล์เมนู", true);
        return;
      }
      target.hidden = false;
      if (button.dataset.view === "bookings-view" && firebaseReady) loadPublicBookings();
    });
  });
}

async function initialize() {
  try {
    await loadComponents();
  } catch (error) {
    showMessage(componentError, `เตรียมเมนูไม่สำเร็จ: ${error.message}`, true);
    return;
  }

  publicBookingsBody = document.getElementById("public-bookings");
  adminBookingsBody = document.getElementById("admin-bookings");
  populateRoomOptions();
  populateYearFilter();
  bindNavigation();

  document.getElementById("position").addEventListener("change", (event) => {
    const isOther = event.target.value === "อื่นๆ";
    document.getElementById("position-other-wrap").hidden = !isOther;
    document.getElementById("position-other").required = isOther;
  });
  document.getElementById("booking-form").addEventListener("submit", submitBooking);
  document.getElementById("month-filter").addEventListener("change", renderPublicBookings);
  document.getElementById("year-filter").addEventListener("change", renderPublicBookings);
  document.getElementById("refresh-bookings").addEventListener("click", loadPublicBookings);
  document.getElementById("refresh-admin").addEventListener("click", loadAdminBookings);
  document.getElementById("admin-login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button[type="submit"]');
    setBusy(button, true, "กำลังเข้าสู่ระบบ...");
    clearMessage(appMessage);
    try {
      await signInWithEmailAndPassword(
        auth,
        document.getElementById("admin-email").value.trim(),
        document.getElementById("admin-password").value
      );
    } catch (error) {
      showMessage(appMessage, `เข้าสู่ระบบไม่สำเร็จ: ${error.message}`, true);
    } finally {
      setBusy(button, false);
    }
  });
  document.getElementById("admin-logout").addEventListener("click", async () => {
    try {
      await signOut(auth);
      clearMessage(appMessage);
    } catch (error) {
      showMessage(appMessage, `ออกจากระบบไม่สำเร็จ: ${error.message}`, true);
    }
  });
  adminBookingsBody.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-booking-id]");
    if (button) updateBookingStatus(button.dataset.bookingId, button.dataset.status, button);
  });

  if (!firebaseReady) {
    showMessage(firebaseMessage, "กรุณากรอก Firebase web app config ใน public/js/firebase-config.js ก่อนใช้งาน", true);
    document.querySelectorAll(
      "#booking-form input, #booking-form select, #booking-form button, " +
      "#admin-login-form input, #admin-login-form button, " +
      "#refresh-bookings, #refresh-admin, #admin-logout"
    ).forEach((element) => { element.disabled = true; });
    return;
  }

  onAuthStateChanged(auth, verifyAdmin);
}

initialize();
