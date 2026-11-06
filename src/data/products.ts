/// ข้อมูลสินค้าทั้งหมด — แหล่งความจริงเดียว
/// ทุกหน้า (หน้าแรก / หน้าสินค้า / เครื่องคิดเลขคาร์บอน / JSON-LD) ดึงจากไฟล์นี้
/// ตัวเลขทั้งหมดยกมาจากเว็บเดิม 2amplus.com/smartbio (ตรวจสอบ ก.ย. 2026)

export interface PackingOption {
  label: string;
  pieces: number;
  packs: number;
  perPack: number;
}

export interface Product {
  slug: string;
  size: number;
  /// ชื่อเต็มใช้ในหน้า detail และ JSON-LD
  name: string;
  /// ชื่อสั้นใช้ในการ์ด/เมนู
  shortName: string;
  dimensions: string;
  /// คำอธิบายหนึ่งบรรทัดว่าเหมาะกับเครื่องดื่มแบบไหน
  useCase: string;
  /// รายการเครื่องดื่มแบบละเอียด ใช้ในหน้า detail
  drinks: string[];
  /// g CO2e ต่อหลอด จาก ISO 14067 — เป็นตัวเลขที่คู่แข่งไม่มี ใช้ในเครื่องคิดเลข ESG
  co2PerStraw: number;
  packing: PackingOption[];
  /// ภาพหลักและภาพรอง — ลบพื้นหลังขาวออกแล้ว วางบนพื้นสีใดก็ได้ไม่มีกรอบสี่เหลี่ยม
  /// เสิร์ฟจากเครื่องเราเอง ไม่ hotlink 2amplus.com (ช้ากว่า และถ้าเขาลบไฟล์เว็บเราพัง)
  /// width/height เก็บไว้กัน layout shift (CLS) ซึ่งเป็นตัวจัดอันดับของ Google
  images: { src: string; alt: string; width: number; height: number }[];
  /// หมายเหตุพิเศษของรุ่นนี้ เช่น มีรุ่นกากกาแฟ
  note?: string;
  /// meta description สำหรับ SEO — เขียนแยกทุกหน้าไม่ให้ซ้ำกัน
  metaDescription: string;
}

export const PRODUCTS: Product[] = [
  {
    slug: 'straw-6mm',
    size: 6,
    name: 'หลอดชานอ้อย Verdeloop 6 มม.',
    shortName: '6 มม.',
    dimensions: '6 × 210 มม.',
    useCase: 'เครื่องดื่มทั่วไป น้ำเปล่า กาแฟเย็น',
    drinks: ['น้ำดื่ม', 'น้ำอัดลม', 'น้ำผลไม้', 'นม', 'กาแฟเย็น', 'ชาเย็น'],
    co2PerStraw: 3.93,
    packing: [
      { label: 'กล่องใหญ่', pieces: 7000, packs: 70, perPack: 100 },
      { label: 'กล่องรีแพค', pieces: 3500, packs: 35, perPack: 100 },
    ],
    images: [
      {
        src: '/img/products/straw-6mm-a.webp',
        alt: 'หลอดชานอ้อย Verdeloop ขนาด 6 x 210 มม. วางคู่กับท่อนอ้อยที่เป็นวัตถุดิบ',
        width: 457,
        height: 480,
      },
      {
        src: '/img/products/straw-6mm-b.webp',
        alt: 'หลอดชานอ้อยขนาด 6 มม. ปักอยู่ในแก้วใส',
        width: 264,
        height: 485,
      },
    ],
    note: 'ขนาด 6 มม. มีรุ่นพิเศษที่ผลิตจากกากกาแฟใช้แล้ว (สั่งผลิตล่วงหน้า)',
    metaDescription:
      'หลอดชานอ้อย 6 × 210 มม. สำหรับกาแฟเย็น ชาเย็น และน้ำผลไม้ ห่อซองกระดาษรายชิ้น เลือกบรรจุ 3,500 หรือ 7,000 ชิ้น พร้อมคำแนะนำเลือกใช้กับแก้วของร้านและขอตัวอย่าง',
  },
  {
    slug: 'straw-8mm',
    size: 8,
    name: 'หลอดชานอ้อย Verdeloop 8 มม.',
    shortName: '8 มม.',
    dimensions: '8 × 210 มม.',
    useCase: 'เมนูปั่น สมูทตี้ มิลค์เชค',
    drinks: ['น้ำปั่น', 'ผลไม้ปั่น', 'กาแฟปั่น', 'ชาเขียวปั่น', 'มิลค์เชค', 'สมูทตี้'],
    co2PerStraw: 5.27,
    packing: [
      { label: 'กล่องใหญ่', pieces: 5000, packs: 50, perPack: 100 },
      { label: 'กล่องรีแพค', pieces: 2500, packs: 25, perPack: 100 },
    ],
    images: [
      {
        src: '/img/products/straw-8mm-a.webp',
        alt: 'หลอดชานอ้อย Verdeloop ขนาด 8 x 210 มม. วางเรียงเป็นแพนคลี่ออก',
        width: 532,
        height: 525,
      },
      {
        src: '/img/products/straw-8mm-b.webp',
        alt: 'หลอดชานอ้อยขนาด 8 มม. ปักอยู่ในแก้วใส ใช้กับเมนูปั่นและมิลค์เชค',
        width: 225,
        height: 493,
      },
    ],
    metaDescription:
      'หลอดชานอ้อย 8 × 210 มม. สำหรับสมูทตี้ มิลค์เชค และกาแฟปั่น ห่อซองรายชิ้น บรรจุ 2,500 หรือ 5,000 ชิ้น ดูวิธีเลือกหลอดตามความข้นของเมนูและขอราคาส่ง',
  },
  {
    slug: 'straw-12mm',
    size: 12,
    name: 'หลอดชานอ้อย Verdeloop 12 มม.',
    shortName: '12 มม.',
    dimensions: '12 × 210 มม.',
    useCase: 'ชานมไข่มุก เครื่องดื่มใส่ท็อปปิ้ง',
    drinks: ['ชานมไข่มุก', 'เครื่องดื่มใส่พุดดิ้ง', 'เฉาก๊วย', 'บุกไข่มุก', 'เครื่องดื่มท็อปปิ้งหนัก'],
    co2PerStraw: 9.69,
    packing: [
      { label: 'กล่องใหญ่', pieces: 2000, packs: 40, perPack: 50 },
      { label: 'กล่องรีแพค', pieces: 1000, packs: 20, perPack: 50 },
    ],
    images: [
      {
        src: '/img/products/straw-12mm-a.webp',
        alt: 'หลอดชานอ้อย Verdeloop ขนาด 12 x 210 มม. ปากกว้างสำหรับชานมไข่มุก',
        width: 900,
        height: 707,
      },
      {
        src: '/img/products/straw-12mm-b.webp',
        alt: 'หลอดชานอ้อยขนาด 12 มม. ปักอยู่ในแก้วใส ดูดไข่มุกได้ไม่ติด',
        width: 322,
        height: 483,
      },
    ],
    note: 'ขนาด 12 มม. บรรจุแพคละ 50 ชิ้น (ต่างจากขนาด 6 และ 8 มม. ที่แพคละ 100 ชิ้น)',
    metaDescription:
      'หลอดชานอ้อย 12 × 210 มม. สำหรับชานมไข่มุก พุดดิ้ง และท็อปปิ้ง ห่อซองรายชิ้น แพคละ 50 ชิ้น ดูบรรจุขายส่งและแนวทางทดสอบกับไข่มุกและฝาซีลของร้าน',
  },
];

export const getProduct = (slug: string): Product | undefined =>
  PRODUCTS.find((p) => p.slug === slug);

/// ใบรับรองทั้งหมด — ใช้ทั้งหน้าแรก (แบบย่อ) และหน้า Compliance (แบบเต็ม)
export interface Certification {
  name: string;
  detail: string;
  /// ใบที่เป็นจุดขายหลัก แสดงเด่นกว่าใบอื่น
  featured?: boolean;
  /// โลโก้เครื่องหมายรับรอง — ใส่เฉพาะใบที่มีไฟล์จริงจากเว็บเดิม
  /// ห้ามวาดเลียนแบบหรือหาจากเน็ตมาใส่เอง: เครื่องหมายรับรองเป็นเครื่องหมายการค้าจดทะเบียน
  /// ใช้ได้เฉพาะไฟล์ที่หน่วยงานให้มาพร้อมสิทธิ์ตอนผ่านการตรวจ
  ///
  /// ⚠️ ค้างอยู่: ใบรับรองชุดนี้กับตัวเลขสเปกทั้งหมดยกมาจาก SmartBio ของ 2AM Plus
  /// ตอนนั้นคิดว่าเป็นบริษัทเดียวกัน แต่ 8 ก.ย. 2569 รู้ว่า Verdeloop เป็นของ "ทองกร46" คนละนิติบุคคล
  /// ใบรับรองออกให้ "ผู้ยื่นขอ" ไม่ได้ออกให้สินค้าลอย ๆ — ถ้าทองกร46 ไม่ใช่ผู้ถือใบหรือผู้นำเข้าที่มีสิทธิ์
  /// การแสดงเครื่องหมายพวกนี้คือการอ้างการรับรองเท็จ (ผิดทั้ง กม.เครื่องหมายการค้าและ พ.ร.บ.คุ้มครองผู้บริโภค)
  /// ต้องถามเจ้าของให้ชัดก่อน deploy ว่าถือสิทธิ์ใช้ใบเหล่านี้ในนามทองกร46 หรือไม่
  /// width/height เก็บไว้กัน layout shift (CLS) ซึ่งเป็นตัวจัดอันดับของ Google
  logo?: { src: string; width: number; height: number };
}

export const CERTIFICATIONS: Certification[] = [
  {
    name: 'TUV Austria — Home Compost',
    detail: 'ย่อยสลายได้เองในกองปุ๋ยหมักที่บ้าน ไม่ต้องส่งโรงงานอุตสาหกรรม',
    featured: true,
    logo: { src: '/img/certs/ok-compost.webp', width: 434, height: 200 },
  },
  {
    name: 'ISO 14067',
    detail: 'ตรวจวัดคาร์บอนฟุตพริ้นต์ของผลิตภัณฑ์ นำตัวเลขไปใช้ในรายงาน ESG ได้',
    featured: true,
    logo: { src: '/img/certs/carbon-footprint.webp', width: 155, height: 200 },
  },
  {
    name: 'PFAS Free',
    detail: 'ปลอดสารเคมีตกค้างกลุ่ม PFAS',
    featured: true,
    logo: { src: '/img/certs/pfas-free.webp', width: 200, height: 200 },
  },
  {
    name: 'US FDA',
    detail: 'ผ่านเกณฑ์วัสดุสัมผัสอาหารขององค์การอาหารและยา สหรัฐอเมริกา',
    logo: { src: '/img/certs/fda.webp', width: 494, height: 200 },
  },
  {
    name: 'EU No.10/2011',
    detail: 'ผ่านระเบียบวัสดุสัมผัสอาหารของสหภาพยุโรป ใช้กับเครื่องดื่มได้โดยตรง',
    logo: { src: '/img/certs/eu-food-contact.webp', width: 188, height: 200 },
  },
  {
    name: 'ISO 22000',
    detail: 'ระบบบริหารความปลอดภัยด้านอาหารตลอดสายการผลิต',
    logo: { src: '/img/certs/iso-22000.webp', width: 206, height: 200 },
  },
  {
    name: 'HACCP',
    detail: 'ระบบวิเคราะห์และควบคุมจุดวิกฤตที่อาจเกิดอันตรายในกระบวนการผลิตอาหาร',
    logo: { src: '/img/certs/haccp.webp', width: 215, height: 200 },
  },
  {
    name: 'DIN CERTCO (ยุโรป)',
    detail: 'มาตรฐานการย่อยสลายทางชีวภาพของยุโรป',
    logo: { src: '/img/certs/din-certco.webp', width: 169, height: 200 },
  },
  {
    name: 'BPI (สหรัฐอเมริกา)',
    detail: 'Biodegradable Products Institute รับรองว่าย่อยสลายได้จริง',
    logo: { src: '/img/certs/bpi.webp', width: 149, height: 200 },
  },
  {
    name: 'REACH SVHC 197',
    detail: 'ไม่พบสารอันตรายสูงตามรายการ 197 ชนิดของยุโรป',
    logo: { src: '/img/certs/reach-svhc.webp', width: 231, height: 200 },
  },
  {
    name: 'Non-5-Plastics',
    detail:
      'ทดสอบแล้วปลอดพลาสติกหลัก 5 ชนิดที่ย่อยสลายยากที่สุด (PET, PP, PE, PS, PVC) ซึ่งเป็นวัสดุหลักของภาชนะใช้ครั้งเดียวทิ้งทั่วไป',
    logo: { src: '/img/certs/plastic-free.webp', width: 201, height: 200 },
  },
  {
    name: 'ไม่ใช่หลอด PLA',
    detail:
      'ไม่ได้ทำจาก PLA จึงไม่ต้องส่งโรงงานอุตสาหกรรมเพื่อย่อยสลาย — ข้อนี้คือความต่างที่มีผลกับวิธีทิ้งของร้านโดยตรง',
    logo: { src: '/img/certs/no-pla.webp', width: 201, height: 200 },
  },
  {
    name: 'Microbial Detection',
    detail: 'ทดสอบแล้วปลอดการปนเปื้อนจุลินทรีย์ก่อโรค เช่น แบคทีเรีย รา และไวรัส',
    logo: { src: '/img/certs/microbial-checked.webp', width: 205, height: 200 },
  },
  {
    name: 'Taiwan Green Mark',
    detail: 'เครื่องหมายรับรองสีเขียวของรัฐบาลไต้หวัน สำหรับสินค้าที่เป็นมิตรต่อสิ่งแวดล้อม',
    logo: { src: '/img/certs/tw-green.webp', width: 119, height: 200 },
  },
  {
    name: 'Gluten Free',
    detail: 'ปลอดกลูเตน ปลอดภัยกับผู้แพ้กลูเตน',
    logo: { src: '/img/certs/gluten-free.webp', width: 199, height: 200 },
  },
  // ISO 9001 ไม่มีไฟล์โลโก้จากทางผู้ผลิต จึงแสดงเป็นข้อความอย่างเดียว
  // (ห้ามหาโลโก้ ISO จากเน็ตมาใส่ — เป็นเครื่องหมายการค้า ใช้ได้เฉพาะไฟล์ที่ผู้ออกใบให้มา)
  { name: 'ISO 9001', detail: 'ระบบบริหารคุณภาพการผลิต' },
];

/// ข้อมูลติดต่อของ Verdeloop
///
/// ⚠️ Verdeloop เป็นแบรนด์ของ "บริษัท ทองกร46 จำกัด" — คนละบริษัทกับ 2AM Plus (เจ้าของ SmartBio)
/// เจ้าของสั่ง 8 ก.ย. 2569 ว่า "ให้ตัดเรื่อง 2 เว็บออกจากกันเลย" เพราะเว็บเดิมยังเปิดอยู่
/// ห้ามเอาเบอร์ อีเมล ที่อยู่ หรือ LINE ของ 2AM Plus กลับมาใส่เด็ดขาด
/// และไม่ต้องทำ 301 redirect จาก 2amplus.com/smartbio (เว็บเดิมไม่ได้ปิด — งานนั้นถูกยกเลิกแล้ว)
export const CONTACT = {
  company: 'บริษัท ทองกร46 จำกัด',
  address: '13/221 หมู่บ้านเมืองทองนิเวศน์ 1 ซอยแจ้งวัฒนะ 14 แขวงทุ่งสองห้อง เขตหลักสี่ กรุงเทพฯ 10210',
  /// เบอร์ Verdeloop ที่เจ้าของยืนยัน 9 ก.ย. 2569 — ทุกหน้าอ่านจากที่นี่
  phone: '098-353-9369' as string | null,
  phoneHref: 'tel:0983539369' as string | null,
  /// ⚠️ รอจดโดเมนก่อน (เจ้าของเลือก info@verdeloopthailand.com)
  email: null as string | null,
  lineId: '@verdeloop',
  lineUrl: 'https://line.me/R/ti/p/@verdeloop',
} as const;

export const SITE = {
  name: 'Verdeloop',
  url: 'https://verdeloopthailand.com',
  tagline: 'หลอดชานอ้อยย่อยสลายได้ 100%',
} as const;
