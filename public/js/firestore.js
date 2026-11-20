// public/js/firestore.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { 
    getFirestore, 
    doc, 
    getDoc,
    updateDoc,
    collection, 
    query, 
    where, 
    getDocs,
    setDoc,
    runTransaction,
    serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// Firebase Web Configuration
const firebaseConfig = {
    apiKey: "AIzaSyAKSRFvMlS-ZYgnGw8Ik3F34NUU9udw9tw",
    authDomain: "studio-1060072528-ff5ab.firebaseapp.com",
    projectId: "studio-1060072528-ff5ab",
    storageBucket: "studio-1060072528-ff5ab.firebasestorage.app",
    messagingSenderId: "311847661185",
    appId: "1:311847661185:web:94a67d92acc656c3b2e780"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

// ============================================================================
// 🛡️ USER PERMISSIONS (COMMITTEES) & AUDIT LOGS
// ============================================================================

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

/**
 * ตรวจสอบสิทธิ์ผู้ใช้งานจาก LINE User ID ใน collection 'committees'
 */
export async function getCommitteeByLineId(lineUserId) {
    try {
        const q = query(
            collection(db, "committees"), 
            where("line_user_id", "==", lineUserId)
        );
        const querySnapshot = await getDocs(q);

        if (!querySnapshot.empty) {
            const docSnap = querySnapshot.docs[0];
            return {
                docId: docSnap.id,
                ...docSnap.data()
            };
        }
        return null;
    } catch (error) {
        console.error("❌ ค้นหา committee จาก line_user_id ล้มเหลว:", error);
        return null;
    }
}

/**
 * ดึงรายชื่อบุคลากร/กรรมการที่ยังไม่ได้ลงทะเบียน (status != 'done' และยังไม่มี line_user_id)
 */
export async function getUnregisteredCommittees() {
    try {
        const querySnapshot = await getDocs(collection(db, "committees"));
        const list = [];
        querySnapshot.forEach((docSnap) => {
            const data = docSnap.data();
            if (data.status !== "done" && !data.line_user_id) {
                list.push({
                    docId: docSnap.id,
                    name: data.name || "",
                    pos: data.pos || "",
                    role: data.role || "staff"
                });
            }
        });
        return list;
    } catch (error) {
        console.error("❌ ดึงรายชื่อกรรมการล้มเหลว:", error);
        return [];
    }
}

/**
 * ผูกบัญชี LINE ID กับรายชื่อบุคลากร และอัปเดต status เป็น 'done'
 */
export async function registerCommitteeLineId(docId, lineUserId) {
    try {
        const committeeRef = doc(db, "committees", docId);
        await updateDoc(committeeRef, {
            line_user_id: lineUserId,
            status: "done",
            updated_at: serverTimestamp()
        });
        
        const updatedSnap = await getDoc(committeeRef);
        return {
            docId: updatedSnap.id,
            ...updatedSnap.data()
        };
    } catch (error) {
        console.error("❌ ผูกบัญชี LINE ล้มเหลว:", error);
        throw error;
    }
}

/**
 * บันทึก Audit Log ลง Firestore collection 'audit_logs'
 */
export async function insertAuditLog(actionType, detailsTxt, lineUserObj) {
    try {
        const logDocId = `LOG_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        const logRef = doc(db, "audit_logs", logDocId);

        await setDoc(logRef, {
            timestamp: serverTimestamp(),
            action: actionType,
            details: detailsTxt,
            user_id: lineUserObj ? (lineUserObj.line_user_id || lineUserObj.id || "System") : "System",
            user_name: lineUserObj ? (lineUserObj.name || "Unknown") : "Unknown",
            user_picture: lineUserObj ? (lineUserObj.picture || "") : ""
        });
        console.log(`✅ Audit Log Saved: [${actionType}] ${detailsTxt}`);
    } catch (error) {
        console.error("❌ บันทึก Audit Log ล้มเหลว:", error);
    }
}

/**
 * ดึงรายการสถานที่/ห้องประชุมทั้งหมดจาก Firestore
 * รองรับ collection: 'kbs_place', 'places', 'kbs_places', 'rooms'
 * และรองรับชื่อฟิลด์หลากหลาย (name, placeName, place_name, location, roomName, title)
 */
export async function getKbsPlaces() {
    const candidateCollections = ["kbs_place", "places", "kbs_places", "rooms"];
    
    for (const colName of candidateCollections) {
        try {
            const querySnapshot = await getDocs(collection(db, colName));
            if (!querySnapshot.empty) {
                const places = [];
                querySnapshot.forEach((docSnap) => {
                    const data = docSnap.data();
                    if (data.active === false) return;

                    const placeName = data.name || data.placeName || data.place_name || data.location || data.roomName || data.room_name || data.title || docSnap.id;
                    const placeCap = data.capacity || data.cap || data.seats || data.seat || data.people || null;

                    places.push({
                        ...data,
                        id: String(data.id || data.placeId || data.place_id || docSnap.id),
                        name: String(placeName),
                        capacity: placeCap,
                        order: typeof data.order === "number" ? data.order : 999
                    });
                });

                if (places.length > 0) {
                    places.sort((a, b) => 
                        a.order - b.order || 
                        a.id.localeCompare(b.id, undefined, { numeric: true }) || 
                        a.name.localeCompare(b.name, "th")
                    );
                    console.log(`✅ โหลดข้อมูลสถานที่จาก Firestore [${colName}] สำเร็จ ${places.length} รายการ:`, places);
                    return places;
                }
            }
        } catch (error) {
            console.warn(`⚠️ ดึงจาก collection '${colName}' ไม่สำเร็จ:`, error.message);
        }
    }

    console.warn("⚠️ ไม่พบข้อมูลสถานที่ใน Firestore (หรือติด Permission) — ใช้รายการมาตรฐานของโรงเรียนแทน");
    // Fallback: รายการห้องมาตรฐานของโรงเรียนกาญจนาภิเษกวิทยาลัย กระบี่
    return [
        { id: "11018", name: "หอประชุม", capacity: 1500, order: 1 },
        { id: "11019", name: "โดมราชพฤกษ์", capacity: 3000, order: 2 },
        { id: "11020", name: "ห้องประชุม Auditorium", capacity: 100, order: 3 },
        { id: "11021", name: "ห้องประชุมราชพฤกษ์", capacity: 30, order: 4 },
        { id: "11022", name: "ห้องทูบี (To Be Number One)", capacity: 200, order: 5 },
        { id: "11023", name: "ห้องประชุมช่อราชพฤกษ์", capacity: 180, order: 6 },
        { id: "11024", name: "ห้องสมาคมผู้ปกครองและครู", capacity: 30, order: 7 }
    ];
}

export async function generateWorkOrderId() {
    const counterRef = doc(db, "counters", "fix_report");
    const currentThaiYear = new Date().getFullYear() + 543;

    const newWoId = await runTransaction(db, async (transaction) => {
        const counterSnap = await transaction.get(counterRef);
        let prefix = "WO";
        let year = currentThaiYear;
        let nextCount = 1;

        if (counterSnap.exists()) {
            const data = counterSnap.data();
            prefix = data.prefix || "WO";
            // หากยังเป็นปี พ.ศ. เดิม ให้นับต่อ (+1) ถ้าขึ้นปีใหม่ให้เริ่ม 1 ใหม่
            if (data.year === currentThaiYear) {
                nextCount = (Number(data.count) || 0) + 1;
            }
        }

        transaction.set(counterRef, {
            prefix: prefix,
            year: year,
            count: nextCount,
            updated_at: serverTimestamp()
        }, { merge: true });

        const paddedNumber = String(nextCount).padStart(4, "0");
        return `${prefix}-${year}-${paddedNumber}`;
    });

    return newWoId;
}

/**
 * 🏛️ ออกเลขที่คำขอจองห้องประชุมตามระเบียบงานสารบรรณ/ระบบราชการ
 * รูปแบบ: BR-2569/0001 (รีเซ็ตนับ 1 ใหม่ทุกปี พ.ศ.)
 */
export async function generateBookingNumber() {
    const counterRef = doc(db, "counters", "room_booking");
    const currentThaiYear = new Date().getFullYear() + 543;

    try {
        const newBookingNo = await runTransaction(db, async (transaction) => {
            const counterSnap = await transaction.get(counterRef);
            let prefix = "BR";
            let year = currentThaiYear;
            let nextCount = 1;

            if (counterSnap.exists()) {
                const data = counterSnap.data();
                prefix = data.prefix || "BR";
                // หากยังเป็นปี พ.ศ. เดียวกัน ให้นับต่อ (+1) ถ้าขึ้นปีใหม่ให้เริ่ม 1 ใหม่
                if (data.year === currentThaiYear) {
                    nextCount = (Number(data.count || data.lastNumber) || 0) + 1;
                }
            }

            transaction.set(counterRef, {
                prefix: prefix,
                year: year,
                count: nextCount,
                updated_at: serverTimestamp()
            }, { merge: true });

            const paddedNumber = String(nextCount).padStart(4, "0");
            return `${prefix}-${year}/${paddedNumber}`;
        });

        return newBookingNo;
    } catch (err) {
        console.warn("⚠️ ไม่สามารถรัน transaction บน counters/room_booking ได้ ใช้การนับจาก publicBookings สำรอง:", err);
        try {
            const snap = await getDocs(collection(db, "publicBookings"));
            const nextCount = snap.size + 1;
            const padded = String(nextCount).padStart(4, "0");
            return `BR-${currentThaiYear}/${padded}`;
        } catch (e) {
            const rand = String(Math.floor(1 + Math.random() * 9999)).padStart(4, "0");
            return `BR-${currentThaiYear}/${rand}`;
        }
    }
}