// public/js/auth-guard.js
import { getCommitteeByLineId } from "./firestore.js";

// ============================================================================
// ⚙️ CONFIGURATION
// ============================================================================
const IS_DEV_MODE = false; // 🎯 ตั้งเป็น true ตอนพัฒนา / เปลี่ยนเป็น false ก่อน Deploy ขึ้นเว็บจริง
const DEV_LINE_USER_ID = "Uee9e25daa4093ff804637d5c55c6be03"; // 🎯 LINE User ID สำหรับทดสอบใน DEV MODE

const isLocal = ["localhost", "127.0.0.1"].includes(window.location.hostname);
const MAIN_PORTAL_URL = isLocal ? "../index.html" : "https://kbs-gm.web.app/";
const SESSION_KEY = "kbs_user";

function redirectToMainPortal() {
  const currentUrl = encodeURIComponent(window.location.href);
  window.location.href = `${MAIN_PORTAL_URL}?redirect=${currentUrl}`;
}

// ============================================================================
// 🔓 1. DEV MODE: ดึงข้อมูลจริงจาก Firestore ด้วย DEV_LINE_USER_ID
// ============================================================================
if (IS_DEV_MODE) {
  console.warn(`⚠️ [Auth Guard] DEV MODE: กำลังตรวจสอบสิทธิ์ด้วย LINE ID: ${DEV_LINE_USER_ID}`);
  const existingRaw = sessionStorage.getItem(SESSION_KEY);
  const existingUser = existingRaw ? JSON.parse(existingRaw) : null;

  if (!existingUser || existingUser.line_user_id !== DEV_LINE_USER_ID) {
    const committee = await getCommitteeByLineId(DEV_LINE_USER_ID);
    if (committee) {
      const devUserSession = {
        docId: committee.docId,
        id: committee.line_user_id,
        line_user_id: committee.line_user_id,
        name: committee.name || "ผู้ใช้งานทดสอบ",
        pos: committee.pos || "",
        position: committee.pos || "บุคลากร",
        picture: committee.picture || committee.pictureUrl || "https://cdn-icons-png.flaticon.com/512/149/149071.png",
        role: committee.role || "staff",
        status: committee.status || "done",
        expiresAt: Date.now() + 8 * 60 * 60 * 1000
      };
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(devUserSession));
    }
  }
} else {
  // ============================================================================
  // 🔒 2. ใช้งานจริง: รับ ?token=... ที่ส่งข้ามมาจาก kbs-main
  // ============================================================================
const urlParams = new URLSearchParams(window.location.search);
  const incomingToken = urlParams.get("token");
  let portalSession = null;

  // กรณีที่ 1: ข้าม Domain (รับค่าจาก ?token=...)
  if (incomingToken) {
    try {
      const jsonStr = decodeURIComponent(escape(atob(incomingToken)));
      portalSession = JSON.parse(jsonStr);
      urlParams.delete("token");
      const cleanQuery = urlParams.toString();
      window.history.replaceState({}, document.title, window.location.pathname + (cleanQuery ? "?" + cleanQuery : ""));
    } catch (err) {
      console.error("❌ ถอดรหัส Token ล้มเหลว:", err);
    }
  } 
  // กรณีที่ 2: Domain เดียวกัน (อ่านจาก localStorage กลางของ kbs-main)
  else if (localStorage.getItem("kbs_user_session")) {
    try {
      portalSession = JSON.parse(localStorage.getItem("kbs_user_session"));
    } catch (e) {
      localStorage.removeItem("kbs_user_session");
    }
  }

  // แปลงข้อมูลจาก kbs-main มาเก็บลง sessionStorage ("kbs_user") ของระบบย่อย
  if (portalSession && portalSession.user) {
    if (portalSession.expiresAt && Date.now() > portalSession.expiresAt) {
      localStorage.removeItem("kbs_user_session");
      sessionStorage.removeItem(SESSION_KEY);
      redirectToMainPortal();
    } else {
      const u = portalSession.user;
      const mappedUser = {
        docId: u.docId || "",
        id: u.line_user_id || u.userId || "",
        line_user_id: u.line_user_id || u.userId || "",
        name: u.name || "ผู้ใช้งาน",
        pos: u.pos || "",
        position: u.pos || "บุคลากร",
        picture: u.picture || u.pictureUrl || "",
        role: u.role || "staff",
        status: "done",
        expiresAt: portalSession.expiresAt || (Date.now() + 8 * 60 * 60 * 1000)
      };
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(mappedUser));
    }
  }
  // ============================================================================
  // 🛡️ 3. ตรวจสอบ Session เดิมใน sessionStorage
  // ============================================================================
const savedUserStr = sessionStorage.getItem(SESSION_KEY);
  if (!savedUserStr) {
    redirectToMainPortal();
  } else {
    try {
      const savedUser = JSON.parse(savedUserStr);
      if (savedUser.expiresAt && Date.now() > savedUser.expiresAt) {
        sessionStorage.removeItem(SESSION_KEY);
        redirectToMainPortal();
      }
    } catch (e) {
      sessionStorage.removeItem(SESSION_KEY);
      redirectToMainPortal();
    }
  }
}