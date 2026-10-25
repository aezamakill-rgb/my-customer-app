// Prompts for the three-AI production team. The same text is used for the
// API mode and for copy/paste into the Claude / ChatGPT / Gemini apps.

import { PLATFORMS, SHOT_SIZES, ANGLES, MOVES, prompterLines } from '../model.js'

export const ROLES = {
  research: {
    name: 'นักรีเสิร์ช',
    emoji: '🔎',
    job: 'หาข้อมูลจริง เทรนด์ ไอเดีย hook และคำถามที่คนดูสงสัย',
  },
  write: {
    name: 'นักเขียนบท',
    emoji: '✍️',
    job: 'เขียนบทพูดและ shot list ทีละฉาก พร้อมถ่ายจริง',
  },
  direct: {
    name: 'ผู้กำกับ/บรรณาธิการ',
    emoji: '🎬',
    job: 'ตรวจบทแบบมืออาชีพ ขัด hook 3 วินาทีแรก จังหวะ มุมกล้อง และ CTA',
  },
}

export const PROVIDERS = {
  claude: { name: 'Claude', app: 'https://claude.ai/new', color: '#d97757' },
  openai: { name: 'ChatGPT', app: 'https://chatgpt.com/', color: '#10a37f' },
  gemini: { name: 'Gemini', app: 'https://gemini.google.com/app', color: '#4b8bf5' },
}

const keys = (o) => Object.keys(o).join('|')

const SCHEMA = `{
  "title": "ชื่อคอนเทนต์",
  "hook_options": ["hook ทางเลือก 1", "hook ทางเลือก 2", "hook ทางเลือก 3"],
  "scenes": [
    {
      "title": "ชื่อฉากสั้นๆ เช่น Hook / จุดเด่นที่ 1 / CTA",
      "kind": "talk | broll",
      "lines": ["บทพูด 1 บรรทัด = 1 ลมหายใจ ไม่เกิน ~12 คำ", "บรรทัดต่อไป"],
      "shot": {
        "size": "${keys(SHOT_SIZES)}",
        "angle": "${keys(ANGLES)}",
        "move": "${keys(MOVES)}",
        "camera": "front | back"
      },
      "direction": "คำสั่งผู้กำกับ: ท่าทาง อารมณ์ น้ำเสียง สิ่งที่ต้องอยู่ในเฟรม แสง",
      "seconds": 5
    }
  ],
  "caption": "แคปชันโพสต์",
  "hashtags": ["#แฮชแท็ก"],
  "notes": ["ข้อสังเกตสำหรับทีมตัดต่อ เช่น ใส่ซับคำสำคัญ ใส่เสียงเอฟเฟกต์ตรงไหน"]
}`

function brief(project) {
  const platform = PLATFORMS.find((p) => p.id === project.platform)?.name ?? project.platform
  return [
    `หัวข้อ: ${project.topic || '(ยังไม่ระบุ)'}`,
    `แพลตฟอร์ม: ${platform} · สัดส่วนภาพ ${project.aspect} · ความยาวเป้าหมาย ~${project.targetSeconds} วินาที`,
    project.audience && `กลุ่มเป้าหมาย: ${project.audience}`,
    project.tone && `โทน/สไตล์: ${project.tone}`,
    project.goal && `เป้าหมายของคลิป: ${project.goal}`,
    project.notes && `ข้อมูลเพิ่มเติมจากเจ้าของ: ${project.notes}`,
  ]
    .filter(Boolean)
    .join('\n')
}

export function scriptToJson(project) {
  return JSON.stringify(
    {
      title: project.name,
      scenes: project.scenes.map((s) => ({
        title: s.title,
        kind: s.kind,
        lines: prompterLines(s.lines),
        shot: s.shot,
        direction: s.direction,
        seconds: s.seconds || undefined,
      })),
    },
    null,
    2,
  )
}

export function researchPrompt(project) {
  return {
    system:
      'คุณคือนักรีเสิร์ชคอนเทนต์โซเชียลมืออาชีพของไทย ค้นหาข้อมูลจริงและเป็นปัจจุบัน อ้างอิงแหล่งที่มาเมื่อเป็นข้อเท็จจริง ห้ามแต่งตัวเลขหรือข้อมูลขึ้นเอง ถ้าไม่แน่ใจให้บอกว่าไม่แน่ใจ',
    user: `ช่วยรีเสิร์ชก่อนเขียนบทคลิปนี้\n\n${brief(project)}\n\nสรุปเป็นภาษาไทย หัวข้อละสั้นๆ:\n1. Insight กลุ่มเป้าหมาย: ปัญหา ความอยากรู้ คำถามที่พบบ่อย\n2. ข้อเท็จจริง/ตัวเลขที่ใช้ในคลิปได้ (พร้อมแหล่งที่มา)\n3. เทรนด์หรือรูปแบบคลิปที่กำลังได้ผลในหัวข้อนี้\n4. ไอเดีย hook 5 แบบ (ประโยคแรกที่ทำให้หยุดเลื่อน)\n5. ข้อควรระวัง (ข้อมูลผิดที่คนชอบพูด, เรื่องลิขสิทธิ์/กฎแพลตฟอร์ม)\n6. คีย์เวิร์ดและแฮชแท็กแนะนำ`,
  }
}

export function writePrompt(project, research) {
  return {
    system:
      'คุณคือนักเขียนบทคอนเทนต์สั้นมืออาชีพ เขียนบทพูดภาษาไทยที่เป็นธรรมชาติ พูดตามได้ทันทีจากเครื่อง teleprompter และวางช็อตที่ถ่ายได้จริงด้วยมือถือ ตอบเป็น JSON อย่างเดียว',
    user: `เขียนบทถ่ายทำพร้อม shot list สำหรับคลิปนี้\n\n${brief(project)}\n\n${
      research ? `ข้อมูลจากนักรีเสิร์ช:\n${research}\n\n` : ''
    }กติกาบทมืออาชีพ:\n- 3 วินาทีแรกต้องเป็น hook ที่ทำให้หยุดเลื่อน (ห้ามขึ้นต้นด้วย "สวัสดีครับ/ค่ะ")\n- ความยาวรวมใกล้ ${project.targetSeconds} วินาที (พูดไทย ~2.8 คำ/วินาที)\n- บทพูดแบ่งบรรทัดละ 1 ลมหายใจ ใช้ภาษาพูด ไม่ใช่ภาษาเขียน\n- สลับช็อตพูด (talk) กับภาพประกอบ (broll) ให้ภาพเปลี่ยนทุก 2-4 วินาทีเมื่อตัดต่อ\n- broll ไม่มี lines แต่ direction ต้องบอกชัดว่าถ่ายอะไร\n- camera: "front" = กล้องหน้า (เซลฟี่), "back" = กล้องหลัง\n- ปิดด้วย CTA ที่ชัดเจน\n\nตอบเป็น JSON ตามโครงนี้เท่านั้น ห้ามมีข้อความอื่น:\n${SCHEMA}`,
  }
}

export function directPrompt(project, scriptJson) {
  return {
    system:
      'คุณคือผู้กำกับและบรรณาธิการคอนเทนต์สั้นระดับมืออาชีพ ตรวจบทให้คมขึ้นโดยไม่เปลี่ยนเนื้อหาหลัก ตอบเป็น JSON อย่างเดียว',
    user: `ตรวจและปรับบทถ่ายทำนี้ให้พร้อมถ่ายจริง\n\n${brief(project)}\n\nบทปัจจุบัน:\n${scriptJson}\n\nเช็กลิสต์ผู้กำกับ:\n- hook 3 วินาทีแรกแรงพอไหม ถ้าไม่ให้เขียนใหม่ (และเสนอทางเลือกใน hook_options)\n- ตัดคำฟุ่มเฟือย ให้ความยาวรวมใกล้ ${project.targetSeconds} วินาที\n- มุมกล้องหลากหลาย ไม่ซ้ำติดกันเกิน 2 ฉาก มี broll พอให้ตัดต่อ\n- direction ทุกฉากบอกอารมณ์ ท่าทาง และสิ่งที่ต้องอยู่ในเฟรม\n- บทพูดลื่นปาก อ่านจาก prompter ได้ บรรทัดละ 1 ลมหายใจ\n- CTA ชัดเจน\n- notes: ใส่คำแนะนำสำหรับตอนตัดต่อ (ซับ เสียงเอฟเฟกต์ จังหวะตัด)\n\nตอบเป็น JSON โครงเดิมทั้งหมด (ฉบับปรับแล้ว) ตามโครงนี้เท่านั้น:\n${SCHEMA}`,
  }
}

/**
 * One prompt that runs the whole team in a single chat, so the user only
 * switches apps once: research → write → direct → final JSON.
 */
export function teamPrompt(project) {
  return {
    system:
      'คุณคือทีมผลิตคอนเทนต์สั้นมืออาชีพ 3 คนในคนเดียว: นักรีเสิร์ช นักเขียนบท และผู้กำกับ ทำงานทีละบทบาทในใจ แล้วส่งงานฉบับสุดท้ายเป็น JSON อย่างเดียว',
    user: `ทำบทถ่ายทำพร้อม shot list สำหรับคลิปนี้ให้เสร็จในรอบเดียว\n\n${brief(project)}\n\nขั้นตอน:\n1. นักรีเสิร์ช: ค้นข้อมูลจริงและเป็นปัจจุบัน (ใช้การค้นเว็บถ้าทำได้) insight กลุ่มเป้าหมาย เทรนด์ ไอเดีย hook ห้ามแต่งตัวเลขเอง\n2. นักเขียนบท: เขียนบทภาษาพูดที่อ่านจาก teleprompter ได้ บรรทัดละ 1 ลมหายใจ hook 3 วินาทีแรกต้องหยุดคนเลื่อน (ห้ามขึ้นต้นด้วย "สวัสดี") ความยาวรวมใกล้ ${project.targetSeconds} วินาที (~2.8 คำ/วินาที) สลับช็อตพูด (talk) กับภาพประกอบ (broll) broll ไม่มี lines แต่ direction ต้องบอกชัดว่าถ่ายอะไร camera: "front" = กล้องหน้า, "back" = กล้องหลัง ปิดด้วย CTA\n3. ผู้กำกับ: ตรวจบทอีกรอบ ขัด hook ตัดคำฟุ่มเฟือย มุมกล้องไม่ซ้ำติดกันเกิน 2 ฉาก ใส่ direction ทุกฉาก และ notes สำหรับตอนตัดต่อ\n\nตอบเป็น JSON ฉบับสุดท้ายตามโครงนี้เท่านั้น (เพิ่มฟิลด์ "research" เป็นสรุปผลรีเสิร์ชสั้นๆ พร้อมแหล่งที่มา) ห้ามมีข้อความอื่น:\n${SCHEMA.replace('{\n', '{\n  "research": "สรุปผลรีเสิร์ช + แหล่งที่มา",\n')}`,
  }
}

// Text that only appears in our own prompts: if the clipboard still holds
// one of these, the user copied the prompt back instead of the answer.
const PROMPT_MARKERS = ['ชื่อฉากสั้นๆ เช่น Hook', 'ช่วยรีเสิร์ชก่อนเขียนบทคลิปนี้', 'เช็กลิสต์ผู้กำกับ:']
export const isOwnPrompt = (text) => PROMPT_MARKERS.some((m) => text.includes(m))

/** Single-message version for pasting into a chat app. */
export const asPaste = ({ system, user }) => `${system}\n\n${user}`
