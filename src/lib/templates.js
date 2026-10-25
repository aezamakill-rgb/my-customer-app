// Ready-made shooting structures that work without any AI. Each follows the
// short-video pattern pros use: hook in 3 seconds → value → proof → call to action.

import { newScene } from './model.js'

const T = (topic) => topic.trim() || 'เรื่องนี้'

export const TEMPLATES = [
  {
    id: 'review',
    name: 'รีวิวสินค้า',
    emoji: '🛍️',
    build: (topic) => [
      newScene({
        title: 'Hook: ผลลัพธ์ก่อน',
        lines: `หยุดก่อน! ถ้ากำลังจะซื้อ${T(topic)} ดูคลิปนี้ก่อน`,
        shot: { size: 'MCU', angle: 'eye', move: 'pushin', camera: 'front' },
        direction: 'ถือสินค้าไว้ข้างหน้า มองกล้องตรงๆ พูดเร็วและมีพลัง',
      }),
      newScene({
        title: 'B-roll: แกะกล่อง/โชว์ของ',
        kind: 'broll',
        shot: { size: 'CU', angle: 'high', move: 'orbit', camera: 'back' },
        direction: 'ถ่ายช้าๆ ใกล้ๆ เห็นรายละเอียด ผิวสัมผัส โลโก้ ถ่ายเผื่อ 2-3 มุม',
        seconds: 4,
      }),
      newScene({
        title: 'จุดเด่น 3 ข้อ',
        lines: `ข้อแรก ...\nข้อสอง ...\nข้อสาม ที่ชอบที่สุดคือ ...`,
        shot: { size: 'MS', angle: 'eye', move: 'static', camera: 'front' },
        direction: 'ยกนิ้วนับ 1-2-3 ให้คนดูตามทัน',
      }),
      newScene({
        title: 'B-roll: ใช้งานจริง',
        kind: 'broll',
        shot: { size: 'MS', angle: 'eye', move: 'handheld', camera: 'back' },
        direction: 'ถ่ายตอนใช้งานจริง ให้เห็นผลลัพธ์ชัดๆ',
        seconds: 5,
      }),
      newScene({
        title: 'ข้อเสีย (ความจริงใจ)',
        lines: 'แต่ที่ต้องบอกตรงๆ คือ ...',
        shot: { size: 'CU', angle: 'eye', move: 'static', camera: 'front' },
        direction: 'น้ำเสียงจริงจังขึ้น ช่วยให้คนเชื่อรีวิว',
      }),
      newScene({
        title: 'CTA',
        lines: 'สรุปคุ้มไหม? คุ้มสำหรับคนที่ ...\nพิกัดอยู่ในคอมเมนต์ กดติดตามไว้ มีรีวิวใหม่ทุกสัปดาห์',
        shot: { size: 'MCU', angle: 'eye', move: 'static', camera: 'front' },
        direction: 'ยิ้ม ชี้ลงด้านล่างตอนพูดถึงคอมเมนต์',
      }),
    ],
  },
  {
    id: 'howto',
    name: 'สอน / How-to',
    emoji: '🧠',
    build: (topic) => [
      newScene({
        title: 'Hook: สัญญาผลลัพธ์',
        lines: `${T(topic)} ทำได้ใน 3 ขั้นตอน ไม่ต้องเก่งก็ทำได้`,
        shot: { size: 'MCU', angle: 'eye', move: 'pushin', camera: 'front' },
        direction: 'โชว์ผลลัพธ์สุดท้ายในมือหรือบนจอด้านหลัง',
      }),
      newScene({
        title: 'ขั้นที่ 1',
        lines: 'ขั้นแรก ...',
        shot: { size: 'TOP', angle: 'high', move: 'static', camera: 'back' },
        direction: 'ถ่ายมุมบนลงล่าง เห็นมือทำงาน',
      }),
      newScene({
        title: 'ขั้นที่ 2',
        lines: 'ขั้นที่สอง ...',
        shot: { size: 'TOP', angle: 'high', move: 'static', camera: 'back' },
      }),
      newScene({
        title: 'ขั้นที่ 3 + เคล็ดลับ',
        lines: 'ขั้นสุดท้าย ...\nเคล็ดลับที่คนส่วนใหญ่ไม่รู้คือ ...',
        shot: { size: 'CU', angle: 'eye', move: 'pushin', camera: 'front' },
      }),
      newScene({
        title: 'CTA',
        lines: 'ลองทำแล้วมาเล่าในคอมเมนต์นะ เซฟคลิปนี้ไว้ดูตอนทำจริง',
        shot: { size: 'MCU', angle: 'eye', move: 'static', camera: 'front' },
      }),
    ],
  },
  {
    id: 'vlog',
    name: 'Vlog / พาเที่ยว',
    emoji: '🎒',
    build: (topic) => [
      newScene({
        title: 'Hook: ภาพสวยสุด',
        kind: 'broll',
        shot: { size: 'WS', angle: 'low', move: 'pushin', camera: 'back' },
        direction: 'เปิดด้วยภาพที่ว้าวที่สุดของทริป 2-3 วินาที',
        seconds: 3,
      }),
      newScene({
        title: 'แนะนำตัว/ที่นี่ที่ไหน',
        lines: `วันนี้พามา${T(topic)} ที่คนบอกว่าต้องมาสักครั้ง`,
        shot: { size: 'MS', angle: 'eye', move: 'follow', camera: 'front' },
        direction: 'ถือกล้องเดินพูด แขนเหยียดสุด กล้องสูงกว่าตาเล็กน้อย',
      }),
      newScene({
        title: 'B-roll: บรรยากาศ',
        kind: 'broll',
        shot: { size: 'WS', angle: 'eye', move: 'pan', camera: 'back' },
        direction: 'แพนช้าๆ 3 ช็อต: กว้าง กลาง ใกล้ (รายละเอียด)',
        seconds: 6,
      }),
      newScene({
        title: 'ไฮไลต์ที่ต้องลอง',
        lines: 'ห้ามพลาดเลยคือ ...',
        shot: { size: 'MCU', angle: 'eye', move: 'handheld', camera: 'front' },
      }),
      newScene({
        title: 'ปิดท้าย + ข้อมูล',
        lines: 'การเดินทาง ...\nค่าใช้จ่ายประมาณ ...\nใครอยากมาบ้าง แท็กเพื่อนเลย',
        shot: { size: 'MS', angle: 'eye', move: 'static', camera: 'front' },
      }),
    ],
  },
  {
    id: 'story',
    name: 'เล่าเรื่อง / Storytime',
    emoji: '🎙️',
    build: (topic) => [
      newScene({
        title: 'Hook: ประโยคค้างคา',
        lines: `ไม่มีใครเชื่อว่า${T(topic)} จะเปลี่ยนชีวิตเราได้ขนาดนี้`,
        shot: { size: 'CU', angle: 'eye', move: 'pushin', camera: 'front' },
        direction: 'นิ่ง จ้องกล้อง เว้นจังหวะก่อนคำสุดท้าย',
      }),
      newScene({
        title: 'ปูเรื่อง',
        lines: 'ตอนนั้น ...',
        shot: { size: 'MCU', angle: 'eye', move: 'static', camera: 'front' },
      }),
      newScene({
        title: 'จุดพลิก',
        lines: 'จนกระทั่ง ...',
        shot: { size: 'CU', angle: 'eye', move: 'static', camera: 'front' },
        direction: 'ขยับเข้าใกล้กล้องอีกนิด ลดเสียงลง สร้างความลุ้น',
      }),
      newScene({
        title: 'บทเรียน + CTA',
        lines: 'สิ่งที่ได้เรียนรู้คือ ...\nถ้าเคยเจอแบบนี้ เล่าให้ฟังหน่อย',
        shot: { size: 'MCU', angle: 'eye', move: 'static', camera: 'front' },
      }),
    ],
  },
  {
    id: 'food',
    name: 'รีวิวอาหาร / ร้าน',
    emoji: '🍜',
    build: (topic) => [
      newScene({
        title: 'Hook: คำแรก',
        kind: 'broll',
        shot: { size: 'ECU', angle: 'eye', move: 'pushin', camera: 'back' },
        direction: 'ชีสยืด น้ำซุปเดือด ควันลอย — ภาพน่ากินที่สุดก่อน',
        seconds: 3,
      }),
      newScene({
        title: 'ร้านนี้คือ',
        lines: `${T(topic)} ร้านนี้คิวยาวทุกวัน วันนี้มาพิสูจน์ว่าคุ้มไหม`,
        shot: { size: 'MS', angle: 'eye', move: 'static', camera: 'front' },
      }),
      newScene({
        title: 'B-roll: เมนู/บรรยากาศ',
        kind: 'broll',
        shot: { size: 'TOP', angle: 'high', move: 'static', camera: 'back' },
        direction: 'ถ่ายจานเรียงบนโต๊ะจากด้านบน แล้วไล่ใกล้ทีละจาน',
        seconds: 5,
      }),
      newScene({
        title: 'ชิม + รีแอ็กชัน',
        lines: 'คำแรก ... \nรสชาติ ...',
        shot: { size: 'MCU', angle: 'eye', move: 'static', camera: 'front' },
        direction: 'ถ่ายรีแอ็กชันจริง ไม่ต้องรีบพูด',
      }),
      newScene({
        title: 'สรุป + พิกัด',
        lines: 'ราคา ... คะแนนเต็มสิบให้ ...\nพิกัดอยู่ในคอมเมนต์',
        shot: { size: 'MCU', angle: 'eye', move: 'static', camera: 'front' },
      }),
    ],
  },
  {
    id: 'sell',
    name: 'ขายของ / โปรโมชัน',
    emoji: '🔥',
    build: (topic) => [
      newScene({
        title: 'Hook: เจ็บปวด',
        lines: `ใครเคยปวดหัวเรื่อง${T(topic)} บ้าง ยกมือ!`,
        shot: { size: 'MCU', angle: 'eye', move: 'pushin', camera: 'front' },
      }),
      newScene({
        title: 'ทางออก',
        lines: 'ตัวนี้ช่วยได้ เพราะ ...',
        shot: { size: 'MS', angle: 'eye', move: 'static', camera: 'front' },
        direction: 'ยกสินค้าเข้ากล้อง ให้โลโก้หันหน้าเข้ากล้อง',
      }),
      newScene({
        title: 'B-roll: พิสูจน์',
        kind: 'broll',
        shot: { size: 'CU', angle: 'eye', move: 'static', camera: 'back' },
        direction: 'ก่อน-หลัง หรือรีวิวลูกค้าจริง',
        seconds: 5,
      }),
      newScene({
        title: 'ข้อเสนอ + เร่งตัดสินใจ',
        lines: 'วันนี้ราคาพิเศษ ...\nหมดเขต ... เท่านั้น\nกดตะกร้าเลย',
        shot: { size: 'MCU', angle: 'eye', move: 'static', camera: 'front' },
        direction: 'พลังเต็ม ชี้ไปที่ปุ่มตะกร้า',
      }),
    ],
  },
]

/** Pro checklist shown before rolling. */
export const PRESHOOT_CHECKLIST = [
  'ชาร์จแบต > 50% และเปิดโหมดห้ามรบกวน/เครื่องบิน',
  'เช็ดเลนส์กล้อง (นิ้วโป้งคือศัตรูของภาพคม)',
  'หันหน้าเข้าหาแสง (หน้าต่าง/ไฟ) ไม่ให้แสงอยู่ด้านหลัง',
  'พื้นหลังเรียบร้อย มีมิติ (ยืนห่างกำแพง 1 เมตรขึ้นไป)',
  'ไมค์: ใกล้ปาก ห้องเงียบ ปิดพัดลม/แอร์เสียงดัง',
  'วางกล้องระดับสายตา ใช้ขาตั้งถ้ามี',
  'พื้นที่เก็บข้อมูลว่างพอ (1 นาที 1080p ≈ 60-100 MB)',
]

export const SHOT_TIPS = {
  ECU: 'เติมเฟรมด้วยรายละเอียดเดียว ใช้มาโคร/ซูม 2x ระวังโฟกัสหลุด',
  CU: 'ตาอยู่เส้นแบ่ง 1/3 บน เว้นที่เหนือหัวน้อยๆ',
  MCU: 'ตัดที่ช่วงอก ตาอยู่เส้น 1/3 บน — ช็อตหลักของการพูด',
  MS: 'ตัดที่เอว เห็นมือ ใช้ตอนต้องใช้ท่าทาง/ถือของ',
  WS: 'เห็นทั้งตัวและสถานที่ ใช้เปิดเรื่องหรือเปลี่ยนฉาก',
  POV: 'ถือกล้องระดับสายตาตัวเอง ให้คนดูรู้สึกเป็นคนทำ',
  OTS: 'ถ่ายข้ามไหล่ เห็นสิ่งที่คนในคลิปกำลังดู',
  TOP: 'กล้องขนานพื้นจริงๆ ใช้ตัววัดระดับช่วย',
}
