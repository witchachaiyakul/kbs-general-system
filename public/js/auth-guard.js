// public/js/auth-guard.js
import { getCommitteeByLineId } from "./firestore.js";

// ============================================================================
// ⚙️ CONFIGURATION
// ============================================================================
const IS_DEV_MODE = false; // 🎯 ปิดเมื่อทดสอบรวมระบบผ่าน kbs-main
const DEV_LINE_USER_ID = "Uee9e25daa4093ff804637d5c55c6be03";

const isLocal = ["localhost", "127.0.0.1"].includes(window.location.hostname);
const MAIN_PORTAL_URL = isLocal ? "../index.html" : "https://kbs-gm.web.app/";
const SESSION_KEY = "kbs_user";

function redirectToMainPortal() {
  const currentUrl = encodeURIComponent(window.location.href);
  window.location.href = `${MAIN_PORTAL_URL}?redirect=${currentUrl}`;
}

/**
 * 🔍 ดึงสิทธิ์เฉพาะของระบบบริหารทั่วไป (role และ general_permission) จากคอลเลกชัน 'committees'
 */
export async function fetchGeneralUserPermissions(docId, lineUserId, fallbackRole = "staff") {
  const extractPerms = (d) => ({
    role: (d.role || fallbackRole).toLowerCase(),
    general_permission: Array.isArray(d.general_permission)
      ? d.general_permission
      : (Array.isArray(d.permissions) ? d.permissions : undefined)
  });

  try {
    if (docId) {
      const userSnap = await getDoc(doc(db, "committees", docId));
      if (userSnap.exists()) return extractPerms(userSnap.data());
    }

    if (lineUserId) {
      const q = query(collection(db, "committees"), where("line_user_id", "==", lineUserId));
      const snap = await getDocs(q);
      if (!snap.empty) return extractPerms(snap.docs[0].data());
    }
  } catch (err) {
    console.warn("⚠️ ดึงสิทธิ์จาก committees ไม่สำเร็จ ใช้สิทธิ์พื้นฐานแทน:", err);
  }

  return { role: fallbackRole.toLowerCase(), general_permission: undefined };
}



// ============================================================================
// 🔓 1. DEV MODE: ดึงข้อมูลจริงจาก Firestore ด้วย DEV_LINE_USER_ID
// ============================================================================
if (IS_DEV_MODE) {
  console.warn(`⚠️ [Auth Guard] DEV MODE: กำลังตรวจสอบสิทธิ์ด้วย LINE ID: ${DEV_LINE_USER_ID}`);
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
      role: (committee.role || "staff").toLowerCase(),
      general_permission: Array.isArray(committee.general_permission) ? committee.general_permission : undefined,
      status: committee.status || "done",
      expiresAt: Date.now() + 8 * 60 * 60 * 1000
    };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(devUserSession));
  } else {
    console.warn("⚠️ [Auth Guard] DEV MODE: ไม่พบข้อมูลใน Firestore หรือเชื่อมต่อไม่ได้ — ใช้บัญชีทดสอบสำรอง (Admin)");
    const fallbackDevSession = {
      docId: "dev_local",
      id: DEV_LINE_USER_ID,
      line_user_id: DEV_LINE_USER_ID,
      name: "ผู้ดูแลระบบ (DEV MODE)",
      pos: "ผู้ดูแลระบบ",
      position: "ผู้ดูแลระบบ",
      picture: "https://cdn-icons-png.flaticon.com/512/149/149071.png",
      role: "admin",
      general_permission: ["kbsroom", "kbsGmManage", "kbsRepair"],
      status: "done",
      expiresAt: Date.now() + 8 * 60 * 60 * 1000
    };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(fallbackDevSession));
  }
} else {
  // ============================================================================
  // 🔒 2. ใช้งานจริง: รับ ?token=... หรือ localStorage ที่ส่งมาจาก kbs-main
  // ============================================================================
  const urlParams = new URLSearchParams(window.location.search);
  const incomingToken = urlParams.get("token");
  let portalSession = null;

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
  } else if (localStorage.getItem("kbs_user_session")) {
    try {
      portalSession = JSON.parse(localStorage.getItem("kbs_user_session"));
    } catch (e) {
      localStorage.removeItem("kbs_user_session");
    }
  }

  // แปลงข้อมูลจาก kbs-main และดึงสิทธิ์ล่าสุด (general_permission) จาก Firestore ('committees')
  if (portalSession && portalSession.user) {
    if (portalSession.expiresAt && Date.now() > portalSession.expiresAt) {
      localStorage.removeItem("kbs_user_session");
      sessionStorage.removeItem(SESSION_KEY);
      redirectToMainPortal();
    } else {
      const u = portalSession.user;
      const lineId = u.line_user_id || u.userId || u.id || "";
      const freshCommittee = lineId ? await getCommitteeByLineId(lineId) : null;

      const mappedUser = {
        docId: freshCommittee?.docId || u.docId || "",
        id: lineId,
        line_user_id: lineId,
        name: freshCommittee?.name || u.name || "ผู้ใช้งาน",
        pos: freshCommittee?.pos || u.pos || "",
        position: freshCommittee?.pos || u.pos || "บุคลากร",
        picture: u.picture || u.pictureUrl || freshCommittee?.picture || "",
        role: (freshCommittee?.role || u.role || "staff").toLowerCase(),
        general_permission: Array.isArray(freshCommittee?.general_permission)
          ? freshCommittee.general_permission
          : (Array.isArray(u.general_permission) ? u.general_permission : undefined),
        status: "done",
        expiresAt: portalSession.expiresAt || (Date.now() + 8 * 60 * 60 * 1000)
      };
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(mappedUser));
    }
  }

  // ============================================================================
  // 🛡️ 3. ตรวจสอบ Session เดิมใน sessionStorage และซิงก์สิทธิ์ล่าสุดจาก Firestore
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
      } else if (savedUser.line_user_id && !Array.isArray(savedUser.general_permission)) {
        // กรณีมี Session เก่าค้างอยู่และยังไม่มี general_permission ให้ดึงอัปเดตทันที
        const freshCommittee = await getCommitteeByLineId(savedUser.line_user_id);
        if (freshCommittee) {
          savedUser.role = (freshCommittee.role || savedUser.role || "staff").toLowerCase();
          if (Array.isArray(freshCommittee.general_permission)) {
            savedUser.general_permission = freshCommittee.general_permission;
          }
          sessionStorage.setItem(SESSION_KEY, JSON.stringify(savedUser));
        }
      }
    } catch (e) {
      sessionStorage.removeItem(SESSION_KEY);
      redirectToMainPortal();
    }
  }
}

// ============================================================================
// 🎨 4. อัปเดต Navbar (ชื่อ, ตำแหน่ง, Role, รูปโปรไฟล์) และปุ่มออกจากระบบให้ทุกหน้า
// ============================================================================
function renderGlobalNavbar() {
  const userStr = sessionStorage.getItem(SESSION_KEY);
  if (!userStr) return;

  try {
    const user = JSON.parse(userStr);

    // 1. อัปเดตข้อมูลบน Navbar
    const nameElem = document.getElementById("headerUserName");
    const posElem = document.getElementById("headerUserPosition");
    const roleElem = document.getElementById("headerUserRole");
    const imgElem = document.getElementById("headerUserImg");

    if (nameElem) nameElem.textContent = user.name || "ผู้ใช้งาน";
    if (posElem) posElem.textContent = `ตำแหน่ง: ${user.position || user.pos || "บุคลากร"}`;
    if (roleElem) roleElem.textContent = `Role: ${(user.role || "staff").toUpperCase()}`;
    if (imgElem && user.picture) imgElem.src = user.picture;

    // 2. ผูกปุ่มออกจากระบบ (รองรับทุกหน้าโดยไม่ต้องเขียนซ้ำ)
    const btnLogout = document.getElementById("btnLogout");
    if (btnLogout && !btnLogout.dataset.bound) {
      btnLogout.dataset.bound = "true";
      btnLogout.addEventListener("click", () => {
        if (confirm("คุณต้องการออกจากระบบใช่หรือไม่?")) {
          sessionStorage.removeItem(SESSION_KEY);
          localStorage.removeItem("kbs_user_session");
          window.location.href = MAIN_PORTAL_URL;
        }
      });
    }

    // 3. 🛡️ ป้องกันการพิมพ์ URL เข้าหน้าย่อยที่ไม่มีสิทธิ์โดยตรง
    const currentRole = (user.role || "staff").toLowerCase();
    if (currentRole !== "admin" && Array.isArray(user.pay_permission)) {
      const pageToMenuMap = {
        "index.html": "index",
        "kbs-book-room.html": "kbsroom",
        "role.html": "kbsbudgetuse"
      };
      const currentFile = window.location.pathname.split("/").pop();
      const requiredMenuId = pageToMenuMap[currentFile];

      if (requiredMenuId && !user.pay_permission.includes(requiredMenuId)) {
        alert("⛔ คุณไม่มีสิทธิ์เข้าถึงหน้านี้");
        window.location.href = "index.html";
      }
    }
  } catch (e) {
    console.error("❌ renderGlobalNavbar error:", e);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", renderGlobalNavbar);
} else {
  renderGlobalNavbar();
}