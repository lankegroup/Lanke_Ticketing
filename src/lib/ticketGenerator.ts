import { pinyin } from 'pinyin-pro';

export interface TicketParams {
  canvas: HTMLCanvasElement;
  qrEl: HTMLCanvasElement | null;
  ticketCode: string;
  sessionName: string;
  sessionDate: string;
  startTime: string;
  endTime: string;
  verificationStart?: string | null;
  verificationEnd?: string | null;
  name: string;
  seatName?: string;
  ticketType?: 'adult' | 'child' | 'concession';
  operatorName: string;
  orderTime: string;
  isSupplementary?: boolean;
  isReprint?: boolean;
  orderStatus?: string;
  ticketPrice?: number;
  serviceFee?: number;
  paidAt?: string;
  printedAt?: string;
  paymentMethod?: 'rmb' | 'lcoin' | 'mixed';
  rmbAmount?: number;
  purchaseChannel?: 'online' | 'offline';
}

function toCnPinyin(text: string): string {
  if (!text) return text;
  if (!/[\u4e00-\u9fff]/.test(text)) return text;
  const result = pinyin(text, { toneType: 'none', nonZh: 'consecutive' });
  const joined = result.replace(/ +/g, '');
  return joined.charAt(0).toUpperCase() + joined.slice(1);
}

function seatToEnglish(seat: string): string {
  const m = seat.match(/^([A-Z])排(\d+)座$/);
  if (!m) return seat;
  return `Row ${m[1]}, Seat ${m[2]}`;
}

function adaptedCnSize(
  ctx: CanvasRenderingContext2D,
  cnText: string,
  cnBase: number,
  enText: string,
  enSize: number,
): number {
  ctx.font = `${cnBase}px sans-serif`;
  const cnW = ctx.measureText(cnText).width;
  ctx.font = `${enSize}px sans-serif`;
  const enW = ctx.measureText(enText).width;
  if (cnW === 0 || enW <= cnW * 1.2) return cnBase;
  return Math.round(cnBase * Math.min(enW / cnW, 1.4));
}

interface RowDef {
  cnLabel: string;
  enLabel: string;
  cnValue: string;
  enValue: string;
  color?: string;
  cnValueBase?: number;
}

export function renderTicketToCanvas(p: TicketParams): void {
  const D = 2;

  const W             = 651 * D;
  const PAD           = 34  * D;
  const QR_SIZE       = 200 * D;
  const LABEL_X       = PAD;
  const VALUE_X       = PAD + 150 * D;

  const LABEL_SIZE    = 22 * D;
  const EN_LABEL_SIZE = 22 * D;
  const VALUE_SIZE    = 28 * D;
  const EN_VALUE_SIZE = 26 * D;
  const EN_OFFSET     = 38 * D;

  const ROW_GAP_BI   = 88 * D;
  const ROW_GAP_MONO = 74 * D;

  const BI_CN_Y_OFF   = 28 * D;
  const MONO_CN_Y_OFF = 20 * D;
  const MONO_EN_Y_OFF = 56 * D;
  const MONO_VAL_Y_OFF = 42 * D;
  const MONO_VALUE_SIZE = 31 * D;

  const LABEL_COLOR    = '#5c4a3a';
  const LABEL_COLOR_EN = '#9b8b7b';
  const VALUE_COLOR    = '#0f172a';
  const VALUE_COLOR_EN = '#374151';

  // ── Pre-compute values ────────────────────────────────────────────────
  // Activity time: "2026-06-30 22:23 – 23:52"
  const activityTimeCn = `${p.sessionDate} ${p.startTime.slice(0, 5)} – ${p.endTime.slice(0, 5)}`;
  const activityTimeEn = activityTimeCn;

  // Verification time with date
  const verifStart = p.verificationStart ? p.verificationStart.slice(0, 5) : '';
  const verifEnd   = p.verificationEnd   ? p.verificationEnd.slice(0, 5) : '';
  const verifRange = verifStart && verifEnd
    ? `${p.sessionDate} ${verifStart} – ${verifEnd}`
    : '';

  const nameEn      = toCnPinyin(p.name);
  const operatorCn  = `前台客服 (工号: ${p.operatorName})`;
  const operatorEn  = `Front Desk Service (Staff ID: ${p.operatorName})`;
  const seatEn      = p.seatName ? seatToEnglish(p.seatName) : '';
  const sessionNameEn = toCnPinyin(p.sessionName);
  const showSessionNameEn = sessionNameEn !== p.sessionName;

  const ticketTypeCn: Record<string, string> = { adult: '成人票', child: '儿童票', concession: '优待票' };
  const ticketTypeEn: Record<string, string> = { adult: 'Adult', child: 'Child', concession: 'Concession' };
  const ticketTypeColor: Record<string, string> = { adult: '#0ea5e9', child: '#10b981', concession: '#f59e0b' };

  let subLabelCn = '活 动 入 场 券';
  let subLabelEn = 'Event Admission Ticket';
  if (p.orderStatus === 'cancelled' || p.orderStatus === 'expired') {
    subLabelCn = '活 动 预 订 证 明';
    subLabelEn = 'Event Booking Proof';
  } else if (p.orderStatus === 'used') {
    subLabelCn = '活 动 入 场 证 明';
    subLabelEn = 'Event Admission Proof';
  }

  // ── Row definitions ──────────────────────────────────────────────────
  const rowDefs: RowDef[] = [
    { cnLabel: '活动时间', enLabel: 'Event Time',   cnValue: activityTimeCn, enValue: activityTimeEn },
    ...(verifRange
      ? [{ cnLabel: '核销时间', enLabel: 'Check-in Time', cnValue: verifRange, enValue: verifRange }]
      : []),
    { cnLabel: '用 户 名', enLabel: 'Username',      cnValue: p.name,         enValue: nameEn },
    ...(p.seatName
      ? [{ cnLabel: '座  位', enLabel: 'Seat', cnValue: p.seatName, enValue: seatEn, cnValueBase: 34 * D }]
      : []),
    { cnLabel: '操作员',   enLabel: 'Operator',    cnValue: operatorCn,     enValue: operatorEn },
    { cnLabel: '下单时间', enLabel: 'Order Time',  cnValue: p.orderTime,    enValue: p.orderTime },
    ...(p.ticketPrice !== undefined && p.ticketPrice > 0
      ? [{ cnLabel: '票  价', enLabel: 'Ticket Price', cnValue: `¥${p.ticketPrice.toFixed(2)}`, enValue: `¥${p.ticketPrice.toFixed(2)}` }]
      : []),
    ...(p.serviceFee !== undefined && p.serviceFee > 0
      ? [{ cnLabel: '手续费', enLabel: 'Service Fee', cnValue: `¥${p.serviceFee.toFixed(2)}`, enValue: `¥${p.serviceFee.toFixed(2)}` }]
      : []),
    ...(p.ticketPrice !== undefined && p.serviceFee !== undefined
      ? [{ cnLabel: '合  计', enLabel: 'Total', cnValue: `¥${(p.ticketPrice + p.serviceFee).toFixed(2)}`, enValue: `¥${(p.ticketPrice + p.serviceFee).toFixed(2)}` }]
      : []),
    ...(p.paidAt
      ? [{ cnLabel: '付款时间', enLabel: 'Payment Time', cnValue: p.paidAt, enValue: p.paidAt }]
      : []),
    ...(p.printedAt
      ? [{ cnLabel: '打印时间', enLabel: 'Print Time', cnValue: p.printedAt, enValue: p.printedAt }]
      : []),
  ];

  function rowHeight(r: RowDef): number {
    return r.cnValue !== r.enValue ? ROW_GAP_BI : ROW_GAP_MONO;
  }

  // ── Header layout ────────────────────────────────────────────────────
  const HEADER_CN_Y   = 78 * D;
  const HEADER_EN_Y   = HEADER_CN_Y + 30 * D;
  const SUBLABEL_CN_Y = showSessionNameEn ? HEADER_EN_Y + 32 * D : HEADER_CN_Y + 32 * D;
  const SUBLABEL_EN_Y = SUBLABEL_CN_Y + 30 * D;
  const DIVIDER_Y     = SUBLABEL_EN_Y + 24 * D;
  const DATA_Y0       = DIVIDER_Y + 26 * D;

  // ── Canvas height ────────────────────────────────────────────────────
  const totalDataH = rowDefs.reduce((sum, r) => sum + rowHeight(r), 0);
  const perfY      = DATA_Y0 + totalDataH + 12 * D;
  const qrTopY     = perfY + 24 * D;
  const FOOTER_H   = 260 * D;
  const H          = qrTopY + QR_SIZE + FOOTER_H;

  p.canvas.width  = W;
  p.canvas.height = H;
  const ctx = p.canvas.getContext('2d')!;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  const grad = ctx.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, '#0ea5e9');
  grad.addColorStop(1, '#06b6d4');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, 11 * D);

  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 1.5 * D;
  ctx.strokeRect(1, 1, W - 2, H - 2);

  // ── Badges ───────────────────────────────────────────────────────────
  const BW = 72 * D; const BH = 34 * D;
  const BX = W - PAD - BW;
  let badgeY = 22 * D;

  function drawBadge(label: string, color: string) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(BX, badgeY, BW, BH, 7 * D);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${19 * D}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(label, BX + BW / 2, badgeY + 23 * D);
    ctx.textAlign = 'left';
    badgeY += BH + 6 * D;
  }

  if (p.isReprint)       drawBadge('补打', '#475569');
  if (p.isSupplementary) drawBadge('补票', '#f97316');

  // ── Header ───────────────────────────────────────────────────────────
  const cnNameSize = adaptedCnSize(ctx, p.sessionName, 40 * D, sessionNameEn, 22 * D);
  ctx.fillStyle = '#0f172a';
  ctx.font = `bold ${cnNameSize}px sans-serif`;
  ctx.fillText(p.sessionName, PAD, HEADER_CN_Y);

  if (showSessionNameEn) {
    ctx.fillStyle = '#5b7b9b';
    ctx.font = `${22 * D}px sans-serif`;
    ctx.fillText(sessionNameEn, PAD, HEADER_EN_Y);
  }

  ctx.fillStyle = '#0ea5e9';
  ctx.font = `${20 * D}px sans-serif`;
  ctx.fillText(subLabelCn, PAD, SUBLABEL_CN_Y);

  ctx.fillStyle = '#38b2d8';
  ctx.font = `${20 * D}px sans-serif`;
  ctx.fillText(subLabelEn, PAD, SUBLABEL_EN_Y);

  // Ticket Type Badge (right of sublabel)
  if (p.ticketType) {
    const TT_BW = 130 * D;
    const TT_BH = 62 * D;
    const TT_BX = W - PAD - TT_BW;
    const TT_BY = SUBLABEL_CN_Y - 28 * D;
    
    ctx.fillStyle = '#0ea5e9';
    ctx.beginPath();
    ctx.roundRect(TT_BX, TT_BY, TT_BW, TT_BH, 12 * D);
    ctx.fill();
    
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${25 * D}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(ticketTypeCn[p.ticketType], TT_BX + TT_BW / 2, TT_BY + 26 * D);
    
    ctx.font = `bold ${18 * D}px sans-serif`;
    ctx.fillText(ticketTypeEn[p.ticketType], TT_BX + TT_BW / 2, TT_BY + 50 * D);
    
    ctx.textAlign = 'left';
  }

  ctx.setLineDash([7 * D, 5 * D]);
  ctx.strokeStyle = '#4b5563';
  ctx.lineWidth = D;
  ctx.beginPath();
  ctx.moveTo(PAD, DIVIDER_Y);
  ctx.lineTo(W - PAD, DIVIDER_Y);
  ctx.stroke();
  ctx.setLineDash([]);

  // ── Data row renderer ─────────────────────────────────────────────────
  function drawRow(def: RowDef, y: number) {
    const isBilingual = def.cnValue !== def.enValue;
    const color = def.color ?? VALUE_COLOR;

    if (isBilingual) {
      const cnBase = def.cnValueBase ?? VALUE_SIZE;
      const cnY = y + BI_CN_Y_OFF;
      const enY = cnY + EN_OFFSET;

      ctx.fillStyle = LABEL_COLOR;
      ctx.font = `${LABEL_SIZE}px sans-serif`;
      ctx.fillText(def.cnLabel, LABEL_X, cnY);

      ctx.fillStyle = color;
      ctx.font = `${cnBase}px sans-serif`;
      ctx.fillText(def.cnValue, VALUE_X, cnY);

      ctx.fillStyle = LABEL_COLOR_EN;
      ctx.font = `${EN_LABEL_SIZE}px sans-serif`;
      ctx.fillText(def.enLabel, LABEL_X, enY);

      ctx.fillStyle = color === VALUE_COLOR ? VALUE_COLOR_EN : color;
      ctx.font = `${EN_VALUE_SIZE}px sans-serif`;
      ctx.fillText(def.enValue, VALUE_X, enY);
    } else {
      const cnY  = y + MONO_CN_Y_OFF;
      const enY  = y + MONO_EN_Y_OFF;
      const valY = y + MONO_VAL_Y_OFF;

      ctx.fillStyle = LABEL_COLOR;
      ctx.font = `${LABEL_SIZE}px sans-serif`;
      ctx.fillText(def.cnLabel, LABEL_X, cnY);

      ctx.fillStyle = LABEL_COLOR_EN;
      ctx.font = `${EN_LABEL_SIZE}px sans-serif`;
      ctx.fillText(def.enLabel, LABEL_X, enY);

      ctx.fillStyle = color;
      ctx.font = `${MONO_VALUE_SIZE}px sans-serif`;
      ctx.fillText(def.cnValue, VALUE_X, valY);
    }
  }

  // ── Data rows ─────────────────────────────────────────────────────────
  let iy = DATA_Y0;
  for (const def of rowDefs) {
    drawRow(def, iy);
    iy += rowHeight(def);
  }
  iy += 12 * D;

  // Perforation divider
  ctx.setLineDash([7 * D, 5 * D]);
  ctx.strokeStyle = '#4b5563';
  ctx.lineWidth = D;
  ctx.beginPath();
  ctx.moveTo(PAD, iy);
  ctx.lineTo(W - PAD, iy);
  ctx.stroke();
  ctx.setLineDash([]);

  // ── QR code ──────────────────────────────────────────────────────────
  const qrY = iy + 24 * D;
  const qrX = (W - QR_SIZE) / 2;
  ctx.fillStyle = '#f8fafc';
  ctx.beginPath();
  ctx.roundRect(qrX - 12 * D, qrY - 12 * D, QR_SIZE + 24 * D, QR_SIZE + 24 * D, 14 * D);
  ctx.fill();
  if (p.qrEl) {
    ctx.drawImage(p.qrEl, qrX, qrY, QR_SIZE, QR_SIZE);
  } else {
    ctx.fillStyle = '#e2e8f0';
    ctx.fillRect(qrX, qrY, QR_SIZE, QR_SIZE);
  }

  // ── Footer ────────────────────────────────────────────────────────────
  ctx.textAlign = 'center';
  const fBase = qrY + QR_SIZE;

  // Ticket code — enlarged
  ctx.fillStyle = '#0369a1';
  ctx.font = `bold ${30 * D}px monospace`;
  ctx.fillText(p.ticketCode, W / 2, fBase + 38 * D);

  // CN instruction
  ctx.fillStyle = '#78716c';
  ctx.font = `${20 * D}px sans-serif`;
  ctx.fillText('入场时出示二维码供工作人员核销', W / 2, fBase + 72 * D);

  // EN instruction
  ctx.fillStyle = '#a8a29e';
  ctx.font = `${22 * D}px sans-serif`;
  ctx.fillText('Present QR code at entrance for staff verification', W / 2, fBase + 98 * D);

  // CN website label
  ctx.fillStyle = '#78716c';
  ctx.font = `${22 * D}px sans-serif`;
  ctx.fillText('详情登录兰克集团票务官网', W / 2, fBase + 134 * D);

  // EN website label
  ctx.fillStyle = '#a8a29e';
  ctx.font = `${22 * D}px sans-serif`;
  ctx.fillText('Visit Lanke Group Official Website for details', W / 2, fBase + 160 * D);

  // URL — larger with more top margin
  ctx.fillStyle = '#0ea5e9';
  ctx.font = `${24 * D}px sans-serif`;
  ctx.fillText('https://lankegroup-booking.bolt.host/', W / 2, fBase + 190 * D);

  // Copyright line — Chinese
  ctx.fillStyle = '#78716c';
  ctx.font = `${20 * D}px sans-serif`;
  ctx.fillText('版权所有 © 2026 兰克集团. 保留所有权利。', W / 2, fBase + 218 * D);
  // Copyright line — English
  ctx.fillStyle = '#a8a29e';
  ctx.font = `${18 * D}px sans-serif`;
  ctx.fillText('Copyright © 2026 Lanke Group. All rights reserved.', W / 2, fBase + 240 * D);

  ctx.textAlign = 'left';
}

/** Format a JS Date to "2026-06-14 22:46:18" */
export function formatOrderTime(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function downloadTicket(canvas: HTMLCanvasElement, ticketCode: string): void {
  const link = document.createElement('a');
  link.download = `ticket-${ticketCode}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
}