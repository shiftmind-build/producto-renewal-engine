/**
 * Las formas que viajan entre el backend y las pantallas.
 *
 * Viven aqui y no dentro de App.tsx por un motivo concreto: el seed de la demo
 * (src/demo.ts) se escribe contra estos mismos tipos. Si el backend cambia un campo, la
 * demo deja de compilar, que es exactamente cuando queremos enterarnos -- y no cuando un
 * comprador la abre y ve una tabla de guiones.
 */

export type Estado =
  | 'activa'
  | 'en_gracia'
  | 'reintentando'
  | 'cancelada'
  | 'vencida'

export type Marca = { _seconds: number }

export type Plan = {
  id: string
  nombre: string
  precio_centavos: number
  moneda: string
  intervalo: 'mes' | 'anyo'
  activos: number
}

export type Suscripcion = {
  id: string
  member_id: string
  member_nombre: string
  plan_id: string
  plan_nombre: string
  estado: Estado
  periodo_fin?: Marca
  mrr_centavos: number
}

export type Intento = {
  id: string
  peldanyo: 1 | 3 | 7
  programado_para: Marca
  resultado: 'pendiente' | 'cobrado' | 'fallido'
  motivo?: string
}

export type Pago = {
  id: string
  importe_centavos: number
  creado_en: Marca
  estado: 'cobrado' | 'fallido'
  motivo?: string
}

/** Lo que devuelve /panel/en-riesgo, ya resuelto a filas en vez de a ids sueltos. */
export type EnRiesgo = {
  en_riesgo: number
  filas: Array<{
    suscripcion_id: string
    member_nombre: string
    plan_nombre: string
    mrr_centavos: number
    peldanyo: 1 | 3 | 7
    proximo_intento: Marca
    motivo: string
  }>
}

export type Detalle = {
  suscripcion: Suscripcion
  pagos: Pago[]
  intentos: Intento[]
  acceso_revocado: boolean
}
