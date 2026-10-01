import type { Detalle, EnRiesgo, Plan, Suscripcion } from './tipos'

/**
 * Los datos de la demo publica.
 *
 * Inventados, y la pantalla lo dice. Lo que NO son es decorativos: estan elegidos para
 * que la demo ensene el producto y no una tabla bonita.
 *
 *   - Hay dos suscripciones en riesgo, en peldanyos distintos (dia 1 y dia 3), porque la
 *     escalera es el producto y con una sola no se ve que es una escalera.
 *   - Hay una que ya se recupero sola, para que se vea que el acceso vuelve.
 *   - Hay una cancelada y una vencida, que NO cuentan como en riesgo: un fallo con los
 *     reintentos agotados esta perdido, no en riesgo, y mezclarlos hace que el numero
 *     grande deje de significar nada.
 */

/**
 * La demo se ancla al momento en que se abre, no a una fecha escrita.
 *
 * Con una fecha fija la demo envejece sola: en diciembre un turno "de hoy" sale con
 * fecha de octubre y un reintento "manyana" sale pasado hace dos meses. Una demo con
 * fechas rancias dice de la empresa exactamente lo contrario de lo que queremos.
 *
 * Redondeado a la hora en punto: un turno de 07:54 a 15:54 no existe en ningun cuadrante
 * del mundo, y ese detalle es lo primero que ve alguien que trabaja con turnos.
 */
const AHORA = Math.floor(Date.now() / 3_600_000) * 3600
const dias = (n: number) => ({ _seconds: AHORA + n * 86400 })

const PLANES: Plan[] = [
  { id: 'plan_studio', nombre: 'Studio', precio_centavos: 2900, moneda: 'USD', intervalo: 'mes', activos: 41 },
  { id: 'plan_team', nombre: 'Team', precio_centavos: 9900, moneda: 'USD', intervalo: 'mes', activos: 18 },
  { id: 'plan_team_anual', nombre: 'Team (annual)', precio_centavos: 99000, moneda: 'USD', intervalo: 'anyo', activos: 6 },
]

const SUSCRIPCIONES: Suscripcion[] = [
  { id: 'sub_1', member_id: 'u_1', member_nombre: 'Northgate Logistics', plan_id: 'plan_team', plan_nombre: 'Team', estado: 'reintentando', periodo_fin: dias(-2), mrr_centavos: 9900 },
  { id: 'sub_2', member_id: 'u_2', member_nombre: 'Halden & Co', plan_id: 'plan_studio', plan_nombre: 'Studio', estado: 'reintentando', periodo_fin: dias(-4), mrr_centavos: 2900 },
  { id: 'sub_3', member_id: 'u_3', member_nombre: 'Mirabel Clinic', plan_id: 'plan_team_anual', plan_nombre: 'Team (annual)', estado: 'activa', periodo_fin: dias(203), mrr_centavos: 8250 },
  { id: 'sub_4', member_id: 'u_4', member_nombre: 'Pike Street Coffee', plan_id: 'plan_studio', plan_nombre: 'Studio', estado: 'activa', periodo_fin: dias(11), mrr_centavos: 2900 },
  { id: 'sub_5', member_id: 'u_5', member_nombre: 'Vantage Surveying', plan_id: 'plan_team', plan_nombre: 'Team', estado: 'en_gracia', periodo_fin: dias(1), mrr_centavos: 9900 },
  { id: 'sub_6', member_id: 'u_6', member_nombre: 'Ardent Legal', plan_id: 'plan_team', plan_nombre: 'Team', estado: 'cancelada', periodo_fin: dias(-31), mrr_centavos: 0 },
  { id: 'sub_7', member_id: 'u_7', member_nombre: 'Lowfield Garage', plan_id: 'plan_studio', plan_nombre: 'Studio', estado: 'vencida', periodo_fin: dias(-19), mrr_centavos: 0 },
]

const EN_RIESGO: EnRiesgo = {
  en_riesgo: 2,
  filas: [
    {
      suscripcion_id: 'sub_1',
      member_nombre: 'Northgate Logistics',
      plan_nombre: 'Team',
      mrr_centavos: 9900,
      peldanyo: 1,
      proximo_intento: dias(1),
      motivo: 'insufficient_funds',
    },
    {
      suscripcion_id: 'sub_2',
      member_nombre: 'Halden & Co',
      plan_nombre: 'Studio',
      mrr_centavos: 2900,
      peldanyo: 3,
      proximo_intento: dias(3),
      motivo: 'expired_card',
    },
  ],
}

const DETALLES: Record<string, Detalle> = {
  sub_1: {
    suscripcion: SUSCRIPCIONES[0]!,
    acceso_revocado: false,
    pagos: [
      { id: 'pay_11', importe_centavos: 9900, creado_en: dias(-2), estado: 'fallido', motivo: 'insufficient_funds' },
      { id: 'pay_10', importe_centavos: 9900, creado_en: dias(-32), estado: 'cobrado' },
      { id: 'pay_9', importe_centavos: 9900, creado_en: dias(-62), estado: 'cobrado' },
    ],
    intentos: [
      { id: 'd_1', peldanyo: 1, programado_para: dias(1), resultado: 'pendiente' },
      { id: 'd_2', peldanyo: 3, programado_para: dias(3), resultado: 'pendiente' },
      { id: 'd_3', peldanyo: 7, programado_para: dias(7), resultado: 'pendiente' },
    ],
  },
  sub_2: {
    suscripcion: SUSCRIPCIONES[1]!,
    acceso_revocado: false,
    pagos: [
      { id: 'pay_22', importe_centavos: 2900, creado_en: dias(-4), estado: 'fallido', motivo: 'expired_card' },
      { id: 'pay_21', importe_centavos: 2900, creado_en: dias(-34), estado: 'cobrado' },
    ],
    intentos: [
      { id: 'd_4', peldanyo: 1, programado_para: dias(-3), resultado: 'fallido', motivo: 'expired_card' },
      { id: 'd_5', peldanyo: 3, programado_para: dias(3), resultado: 'pendiente' },
      { id: 'd_6', peldanyo: 7, programado_para: dias(7), resultado: 'pendiente' },
    ],
  },
  sub_5: {
    suscripcion: SUSCRIPCIONES[4]!,
    acceso_revocado: false,
    pagos: [
      { id: 'pay_51', importe_centavos: 9900, creado_en: dias(-1), estado: 'cobrado' },
      { id: 'pay_50', importe_centavos: 9900, creado_en: dias(-6), estado: 'fallido', motivo: 'do_not_honor' },
    ],
    // El dia 1 fallo y el dia 3 cobro: la escalera se para sola y el acceso nunca se
    // llego a tocar. Es el caso que mas vende y el que nadie ensena.
    intentos: [
      { id: 'd_7', peldanyo: 1, programado_para: dias(-5), resultado: 'fallido', motivo: 'do_not_honor' },
      { id: 'd_8', peldanyo: 3, programado_para: dias(-1), resultado: 'cobrado' },
    ],
  },
  sub_7: {
    suscripcion: SUSCRIPCIONES[6]!,
    // Los tres peldanyos agotados. Es el unico caso donde se corta el acceso.
    acceso_revocado: true,
    pagos: [{ id: 'pay_71', importe_centavos: 2900, creado_en: dias(-19), estado: 'fallido', motivo: 'card_declined' }],
    intentos: [
      { id: 'd_9', peldanyo: 1, programado_para: dias(-18), resultado: 'fallido', motivo: 'card_declined' },
      { id: 'd_10', peldanyo: 3, programado_para: dias(-16), resultado: 'fallido', motivo: 'card_declined' },
      { id: 'd_11', peldanyo: 7, programado_para: dias(-12), resultado: 'fallido', motivo: 'card_declined' },
    ],
  },
}

export const DEMO: Record<string, unknown> = {
  '/panel/en-riesgo': EN_RIESGO,
  '/panel/suscripciones': { suscripciones: SUSCRIPCIONES },
  '/panel/planes': { planes: PLANES },
  ...Object.fromEntries(Object.entries(DETALLES).map(([id, d]) => [`/panel/suscripcion/${id}`, d])),
}
