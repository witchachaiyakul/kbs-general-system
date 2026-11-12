# ระบบจองห้องประชุม (Firebase)

หน้าแรกอยู่ที่ `public/index.html` ส่วนเมนูจอง รายการจอง และผู้ดูแล แยกเป็น HTML ใน `public/components` ใช้ Firebase Authentication สำหรับผู้ดูแล และ Firestore สำหรับข้อมูลจอง

## ตั้งค่า Firebase

1. สร้าง Firebase project และเพิ่ม Web app
2. เปิดใช้งาน Firestore Database และ Authentication แบบ Email/Password
3. กรอก Web app config ใน `public/js/firebase-config.js` (ค่า web config เป็นข้อมูลสาธารณะ ห้ามใส่ service account key หรือรหัสลับในไฟล์หน้าเว็บ)
4. สร้างบัญชีผู้ดูแลใน Firebase Authentication แล้วคัดลอก UID
5. ใน Firestore สร้างเอกสาร `users/{UID}` โดยกำหนดฟิลด์ `role` เป็น `admin`
6. Deploy `firestore.rules` และ `firestore.indexes.json` ไปยัง Firebase project ก่อนเปิดให้ใช้งาน

## ทดสอบด้วย Live Server

เปิดโฟลเดอร์ `public` ด้วย Live Server แล้วเข้าหน้า `index.html` ผ่าน `http://localhost` หรือ `http://127.0.0.1` หาก Firebase Auth ปฏิเสธโดเมน ให้เพิ่ม host ที่ใช้ทดสอบใน Authentication > Settings > Authorized domains

## Deploy Firebase Hosting

ติดตั้ง Firebase CLI แล้วรันจากโฟลเดอร์โปรเจกต์:

```sh
firebase login
firebase use --add
firebase deploy --only firestore:rules,firestore:indexes,hosting
```

## ขอบเขตและข้อมูล

- ระบบรองรับคำขอจอง, รายการสถานะสาธารณะ และผู้ดูแลอนุมัติ/ปฏิเสธ
- ผู้ส่งคำขอไม่ต้องเข้าสู่ระบบ รายการสาธารณะจะแสดงชื่อผู้จอง สถานที่ วันเวลา และสถานะ ส่วนโทรศัพท์/วัตถุประสงค์อ่านได้เฉพาะผู้ดูแล
- ป้องกันเวลาจองทับซ้อนด้วยการตรวจสอบก่อนบันทึกจากหน้าเว็บ การตรวจสอบนี้ไม่ใช่ atomic transaction; หากมีผู้ส่งคำขอพร้อมกันมาก ควรย้ายการตรวจสอบและการสร้างรายการไป Cloud Functions
- ไม่รวม Google Calendar, Google Drive, LINE, การจัดการบัญชีผู้ใช้ และไฟล์แนบจากระบบเดิม
- รายชื่อห้องเริ่มต้นอยู่ใน `public/js/app.js` และรายการสาธารณะแสดงไม่เกิน 100 รายการล่าสุด
