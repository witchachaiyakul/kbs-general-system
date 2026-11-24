// public/js/index.js
import "./auth-guard.js";
import { insertAuditLog, fetchGeneralUserPermissions } from "./firestore.js";

let currentUser = null;

const isLocal = ["localhost", "127.0.0.1"].includes(window.location.hostname);
const MAIN_PORTAL_URL = isLocal ? "../index.html" : "https://kbs-gm.web.app/";

// ==========================================
// 🛡️ INITIALIZATION
// ==========================================
async function initDashboard() {
    const userSessionStr = sessionStorage.getItem("kbs_user");

    if (!userSessionStr) {
        window.location.href = `${MAIN_PORTAL_URL}?redirect=${encodeURIComponent(window.location.href)}`;
        return;
    }

    try {
        currentUser = JSON.parse(userSessionStr);

        // 🔍 ดึงสิทธิ์ล่าสุด (role และ general_permission) จาก Firestore 'committees'
        const latestPerms = await fetchGeneralUserPermissions(
            currentUser.docId,
            currentUser.line_user_id || currentUser.id,
            currentUser.role || "staff"
        );

        currentUser.role = latestPerms.role;
        if (Array.isArray(latestPerms.general_permission)) {
            currentUser.general_permission = latestPerms.general_permission;
        }
        sessionStorage.setItem("kbs_user", JSON.stringify(currentUser));

        initUserProfile(currentUser);
        applyUserPermissions(currentUser);
    } catch (e) {
        console.error("❌ อ่านข้อมูลผู้ใช้งานล้มเหลว:", e);
        sessionStorage.removeItem("kbs_user");
        localStorage.removeItem("kbs_user_session");
        window.location.href = MAIN_PORTAL_URL;
        return;
    }

    const btnBackToPortal = document.getElementById("btnBackToPortal");
    if (btnBackToPortal) {
        btnBackToPortal.href = MAIN_PORTAL_URL;
    }

    bindLogoutBtn();
}

// รันได้ทันทีทั้งกรณีก่อนและหลัง DOMContentLoaded
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initDashboard);
} else {
    initDashboard();
}

/**
 * อัปเดตข้อมูลผู้ใช้งาน (ชื่อ, ตำแหน่ง, Role) บน Navbar
 */
function initUserProfile(user) {
    const nameElem = document.getElementById("headerUserName");
    const posElem = document.getElementById("headerUserPosition");
    const roleElem = document.getElementById("headerUserRole");
    const imgElem = document.getElementById("headerUserImg");

    if (nameElem) nameElem.textContent = user.name || "ผู้ใช้งาน";
    if (posElem) posElem.textContent = `ตำแหน่ง: ${user.pos || user.position || "บุคลากร"}`;
    if (roleElem) roleElem.textContent = `Role: ${(user.role || "staff").toUpperCase()}`;
    if (imgElem && user.picture) imgElem.src = user.picture;
}

/**
 * 🔒 ตรวจสอบสิทธิ์และซ่อน/แสดงปุ่มเมนูตาม general_permission
 */
export function applyUserPermissions(userData) {
    if (!userData) return;

    const userRole = (userData.role || "staff").toLowerCase();
    const hasCustomPerms = Array.isArray(userData.general_permission);

    // ถ้าเคยบันทึก general_permission แล้วให้ใช้ค่านั้น 100% ถ้ายังไม่เคยให้ใช้ค่าเริ่มต้นตาม Role
    const allowedMenus = hasCustomPerms
        ? userData.general_permission
        : (userRole === "admin" ? ["kbsroom", "kbsGmManage"] : ["kbsroom"]);

    const menuItems = document.querySelectorAll(".menu-item");
    menuItems.forEach((item) => {
        const menuId = item.getAttribute("data-menu-id") || "";
        const canAccess = allowedMenus.includes(menuId);
        item.classList.toggle("d-none", !canAccess);
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
        if (currentUser) {
            await insertAuditLog("LOGOUT", `ออกจากระบบสำเร็จ`, currentUser);
        }
        sessionStorage.removeItem("kbs_user");
        localStorage.removeItem("kbs_user_session");
        window.location.href = MAIN_PORTAL_URL;
    }
}