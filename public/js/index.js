// public/js/index.js
import "./auth-guard.js";
import { insertAuditLog } from "./firestore.js";

// ==========================================
// ⚙️ CONFIGURATION & MOCK DATA (DEV MODE)
// ==========================================
const IS_DEV_MODE = false; // 🎯 เปลี่ยนเป็น false เมื่อนำไปใช้งานจริง

// ข้อมูลจำลองสำหรับทดสอบระบบใน DEV MODE
const DEV_MOCK_USER = {
    id: "DEV_USER_001",
    name: "นายนวิชชา ทดสอบ",
    position: "ครู",
    picture: "https://cdn-icons-png.flaticon.com/512/149/149071.png",
    role: "admin", // ตัวเลือก: 'admin', 'officer', 'staff'
    status: "done"
};

let currentUser = null;

const MAIN_PORTAL_URL = "https://kbs-gm.web.app/";

// ==========================================
// 🛡️ AUTH GUARD & INITIALIZATION
// ==========================================
document.addEventListener("DOMContentLoaded", () => {
    
    // --------------------------------------------------
    // 🔓 กรณี 1: เปิดใช้งาน DEV MODE (ข้ามการตรวจสอบ Login/LINE)
    // --------------------------------------------------
    if (IS_DEV_MODE) {
        console.warn("⚠️ ระบบกำลังทำงานใน [DEV MODE]");
        
        document.getElementById("devModeBadge")?.classList.remove("d-none");
        document.getElementById("devRoleSelector")?.classList.remove("d-none");

        const savedDevUser = sessionStorage.getItem("kbs_user");
        currentUser = savedDevUser ? JSON.parse(savedDevUser) : DEV_MOCK_USER;
        sessionStorage.setItem("kbs_user", JSON.stringify(currentUser));

        initUserProfile(currentUser);
        applyRolePermissions(currentUser.role);

        const selectDevRole = document.getElementById("selectDevRole");
        if (selectDevRole) {
            selectDevRole.value = currentUser.role || "admin";
            selectDevRole.addEventListener("change", (e) => {
                currentUser.role = e.target.value;
                sessionStorage.setItem("kbs_user", JSON.stringify(currentUser));
                initUserProfile(currentUser);
                applyRolePermissions(currentUser.role);
            });
        }

        bindLogoutBtn();
        return;
    }

    // --------------------------------------------------
    // 🔒 กรณี 2: ใช้งานจริง (รับ Session จาก auth-guard.js)
    // --------------------------------------------------
    const userSessionStr = sessionStorage.getItem("kbs_user");

    if (!userSessionStr) {
        window.location.href = `${MAIN_PORTAL_URL}?redirect=${encodeURIComponent(window.location.href)}`;
        return;
    }

    try {
        currentUser = JSON.parse(userSessionStr);
        initUserProfile(currentUser);
        applyRolePermissions(currentUser.role);
    } catch (e) {
        console.error("❌ อ่านข้อมูลผู้ใช้งานล้มเหลว:", e);
        sessionStorage.removeItem("kbs_user");
        window.location.href = MAIN_PORTAL_URL;
        return;
    }

    bindLogoutBtn();
});

/**
 * อัปเดตข้อมูลผู้ใช้งาน (ชื่อ, ตำแหน่ง, Role) บน Navbar
 */
function initUserProfile(user) {
    const nameElem = document.getElementById("headerUserName");
    const posElem = document.getElementById("headerUserPosition");
    const roleElem = document.getElementById("headerUserRole");
    const imgElem = document.getElementById("headerUserImg");

    if (nameElem) nameElem.textContent = user.name || "ผู้ใช้งาน";
    if (posElem) posElem.textContent = `ตำแหน่ง: ${user.position || "บุคลากร"}`;
    if (roleElem) roleElem.textContent = `Role: ${(user.role || "staff").toUpperCase()}`;
    if (imgElem && user.picture) imgElem.src = user.picture;
}

/**
 * ควบคุมการซ่อน/แสดง เมนูตามระดับสิทธิ์ (Role-based UI)
 * - admin: มองเห็นทุกเมนู
 * - officer: เห็นเมนูทั่วไป + แผนโครงการ + ออกเลข
 * - staff: เห็นเฉพาะเมนูจัดซื้อจัดจ้าง และ ตัดแผน
 */
function applyRolePermissions(role) {
    const currentRole = (role || "staff").toLowerCase();
    const menuItems = document.querySelectorAll(".menu-item");

    menuItems.forEach(item => {
        const allowedRoles = item.getAttribute("data-role");
        if (!allowedRoles || allowedRoles === "all") {
            item.classList.remove("d-none");
        } else {
            const rolesArray = allowedRoles.split(",").map(r => r.trim().toLowerCase());
            if (rolesArray.includes(currentRole) || currentRole === "admin") {
                item.classList.remove("d-none");
            } else {
                item.classList.add("d-none"); // ซ่อนเมนูที่ผู้ใช้ไม่มีสิทธิ์
            }
        }
    });
}

function bindLogoutBtn() {
    const btnLogout = document.getElementById("btnLogout");
    if (btnLogout) {
        btnLogout.addEventListener("click", () => handleLogout());
    }
}

/**
 * ออกจากระบบ
 */
async function handleLogout() {
    if (confirm("คุณต้องการออกจากระบบใช่หรือไม่?")) {
        if (currentUser && !IS_DEV_MODE) {
            await insertAuditLog("LOGOUT", `ออกจากระบบสำเร็จ`, currentUser);
        }
        sessionStorage.removeItem("kbs_user");
        window.location.href = MAIN_PORTAL_URL; // กลับไปหน้า Portal กลาง
    }
}

/**
 * 🔒 ตรวจสอบสิทธิ์และซ่อน/แสดงปุ่มเมนูใน main.html
 * @param {Object} userData ข้อมูลผู้ใช้งานที่ล็อกอิน ดึงมาจาก Firestore `users/{uid}`
 */
export function applyUserPermissions(userData) {
  if (!userData) return;

  const userRole = (userData.role || 'staff').toLowerCase();
  const userPermissions = Array.isArray(userData.permissions) ? userData.permissions : [];

  const menuItems = document.querySelectorAll('.menu-item');

  menuItems.forEach(item => {
    const rolesAllowed = (item.getAttribute('data-role') || '').toLowerCase().split(',');

    // ดึง onclick จากตัว .menu-item เอง หรือจาก .menu-card ที่อยู่ข้างใน
    const clickableEl = item.hasAttribute('onclick') ? item : item.querySelector('[onclick]');
    const onclickAttr = clickableEl ? clickableEl.getAttribute('onclick') : '';
    const match = onclickAttr.match(/showForm\(['"]([^'"]+)['"]\)/);
    const formId = match ? match[1] : '';

    let canAccess = false;

    // 1. ถ้าเป็น Admin ให้เข้าถึงได้ทุกเมนู
    if (userRole === 'admin') {
      canAccess = true;
    } 
    // 2. ถ้ามีการระบุ permissions เฉพาะเมนูไว้ ให้ยึดตามสิทธิ์เฉพาะรายบุคคลก่อน
    else if (userPermissions.length > 0 && formId) {
      canAccess = userPermissions.includes(formId);
    } 
    // 3. ถ้าไม่มีการตั้งค่าสิทธิ์เฉพาะ ให้ยึดตามสิทธิ์ data-role พื้นฐานใน HTML
    else {
      if (rolesAllowed.includes('all') || rolesAllowed.includes(userRole)) {
        canAccess = true;
      }
    }

    // ซ่อน หรือ แสดง ปุ่มเมนู
    if (canAccess) {
      item.classList.remove('d-none');
      item.style.display = '';
    } else {
      item.classList.add('d-none');
      item.style.display = 'none';
    }
  });
}

// ==========================================
// 3. ฟังก์ชันสลับหน้า (Dashboard <-> Form)
// ==========================================
// กำหนดรายการ Selector ของทุก Section ไว้ที่เดียว (เพิ่ม #kbsUserManage เรียบร้อย)
const SECTION_SELECTORS = '.form-container, #kbsparcelmanage, #kbslogno, #kbsbudget, #kbsPay, #kbsbudgetuse, #kbsUserManage';
// กำหนดหน้าที่เป็นไฟล์ HTML แยกต่างหาก (เพื่อให้ใช้ onclick="showForm('...')" ร่วมกับระบบสิทธิ์ได้)
const EXTERNAL_PAGES = {
    'kbs-book-room': 'kbs-book-room.html',
    'kbsBookRoom': 'kbs-book-room.html'
};
// จับคู่ ID ของฟอร์มกับฟังก์ชันโหลดข้อมูลเริ่มต้น
const SECTION_LOADERS = {
    kbsPay: () => window.loadKbsPayMasterData?.(),
    kbsbudget: () => window.loadKbsBudgetData?.(),
    kbslogno: () => window.loadLogPoData?.(),
    kbsbudgetuse: () => window.loadBudgetUseData?.(),
    kbsparcelmanage: () => window.loadParcelDataFromLogPay?.(true),
    kbsUserManage: () => window.loadUsersTable?.()
};

function hideAllSections() {
    document.querySelectorAll(SECTION_SELECTORS).forEach(sec => {
        sec.classList.add('d-none');
        sec.style.display = 'none';
    });
}

window.showForm = function(sectionId) {
    // 1. กรณีเป็นเมนูที่แยกออกไปเป็นไฟล์ HTML ใหม่
    if (EXTERNAL_PAGES[sectionId]) {
        window.location.href = EXTERNAL_PAGES[sectionId];
        return;
    }

    const mainDashboard = document.getElementById('mainDashboard');

    // 2. กรณีกลับหน้าหลัก (Dashboard)
    if (sectionId === 'dashboard' || sectionId === 'mainDashboard') {
        hideAllSections();
        if (mainDashboard) {
            mainDashboard.classList.remove('d-none');
            mainDashboard.style.display = 'block';
        }
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
    }

    // 3. กรณีเปิดฟอร์มภายในหน้าหลัก
    const targetSection = document.getElementById(sectionId);
    if (!targetSection) {
        alert(`❌ ไม่พบส่วนฟอร์มที่มี ID: "${sectionId}" กรุณาตรวจสอบการตั้งชื่อ ID ใน HTML`);
        return;
    }

    if (mainDashboard) {
        mainDashboard.classList.add('d-none');
        mainDashboard.style.display = 'none';
    }

    hideAllSections();
    targetSection.classList.remove('d-none');
    targetSection.style.display = 'block';

    window.scrollTo({ top: 0, behavior: 'smooth' });

    // เรียกโหลดข้อมูลย่อยอัตโนมัติ (ถ้ามี)
    if (SECTION_LOADERS[sectionId]) {
        SECTION_LOADERS[sectionId]();
    }
};

window.resetFormToMain = function() {
    window.showForm('dashboard');
};
