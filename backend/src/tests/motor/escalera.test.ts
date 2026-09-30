import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { deleteApp, initializeApp, type App } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { CALENDARIO_DIAS, ejecutarPendientes, programarEscalera } from '../../motor/escalera.js'

/**
 * La escalera de reintentos, contra el emulador de Firestore.
 *
 * Esto no comprueba que el codigo "funcione" en abstracto: comprueba los cuatro casos
 * que cuestan dinero de verdad si salen mal.
 *
 *   - Cobrar dos veces a alguien que ya pago por otra via.
 *   - Cortarle el acceso a alguien al primer fallo en vez de al ultimo.
 *   - Dejar el acceso cortado despues de que su cobro haya entrado.
 *   - Programar seis intentos porque Stripe entrego el mismo evento dos veces.
 */

const PROYECTO = 'shiftmind-renewal-engine'
let app: App

const ahora = new Date('2026-10-01T09:00:00Z')
const enDias = (d: number) => new Date(ahora.getTime() + d * 24 * 60 * 60 * 1000)

beforeAll(() => {
  process.env['FIRESTORE_EMULATOR_HOST'] = '127.0.0.1:8080'
  // Sin nombre: el motor usa la app por defecto, y una app con nombre no la ve.
  app = initializeApp({ projectId: PROYECTO })
})

afterAll(async () => {
  await deleteApp(app)
})

async function limpia() {
  const db = getFirestore()
  for (const c of ['subscriptions', 'payments', 'dunning_attempts', 'access_grants']) {
    const docs = await db.collection(c).get()
    await Promise.all(docs.docs.map((d) => d.ref.delete()))
  }
}

/** Una suscripcion con su cobro fallido y el acceso todavia concedido. */
async function sembrar() {
  const db = getFirestore()
  const sus = await db.collection('subscriptions').add({
    member_id: 'uid-ana',
    plan_id: 'plan-1',
    estado: 'activa',
    periodo_fin: Timestamp.fromDate(enDias(30)),
    stripe_subscription_id: 'sub_123',
  })
  const pago = await db.collection('payments').add({
    subscription_id: sus.id,
    importe_centavos: 2900,
    moneda: 'usd',
    estado: 'fallido',
    intento: 1,
    creado_en: Timestamp.fromDate(ahora),
  })
  await db.collection('access_grants').add({
    member_id: 'uid-ana',
    activo: true,
    concedido_en: Timestamp.fromDate(enDias(-30)),
    revocado_en: null,
    motivo: 'alta',
  })
  return { susId: sus.id, pagoId: pago.id }
}

const accesoActivo = async () => {
  const db = getFirestore()
  const g = await db
    .collection('access_grants')
    .where('member_id', '==', 'uid-ana')
    .where('activo', '==', true)
    .get()
  return !g.empty
}

beforeEach(limpia)

describe('escalera de reintentos', () => {
  it('programa tres intentos, en los dias 1, 3 y 7', async () => {
    const { pagoId } = await sembrar()
    const r = await programarEscalera(pagoId, ahora)
    expect(r.creados).toBe(3)

    const db = getFirestore()
    const intentos = await db.collection('dunning_attempts').orderBy('numero_intento').get()
    const dias = intentos.docs.map((d) =>
      Math.round(
        (d.data()['programado_para'].toDate().getTime() - ahora.getTime()) / (24 * 60 * 60 * 1000),
      ),
    )
    expect(dias).toEqual([...CALENDARIO_DIAS])
  })

  it('no duplica la escalera si el webhook llega dos veces', async () => {
    const { pagoId } = await sembrar()
    await programarEscalera(pagoId, ahora)
    const segunda = await programarEscalera(pagoId, ahora)

    expect(segunda.creados).toBe(0)
    const db = getFirestore()
    expect((await db.collection('dunning_attempts').get()).size).toBe(3)
  })

  it('NO cobra si el pago ya entro por otra via entre medias', async () => {
    const { pagoId } = await sembrar()
    await programarEscalera(pagoId, ahora)
    // El owner lo cobro a mano, o el cliente puso otra tarjeta.
    await getFirestore().collection('payments').doc(pagoId).update({ estado: 'cobrado' })

    let llamadas = 0
    const r = await ejecutarPendientes(async () => {
      llamadas += 1
      return { ok: true }
    }, enDias(1.1))

    expect(llamadas).toBe(0)
    expect(r.cancelados).toBe(1)
    expect(r.cobrados).toBe(0)
  })

  it('un cobro que entra cancela los intentos que quedaban', async () => {
    const { pagoId } = await sembrar()
    await programarEscalera(pagoId, ahora)

    await ejecutarPendientes(async () => ({ ok: true, stripe_payment_intent_id: 'pi_ok' }), enDias(1.1))

    const db = getFirestore()
    const restantes = await db
      .collection('dunning_attempts')
      .where('resultado', '==', 'pendiente')
      .get()
    expect(restantes.size).toBe(0)
    expect((await db.collection('payments').doc(pagoId).get()).data()!['estado']).toBe('cobrado')
  })

  it('no corta el acceso en el primer fallo, solo al agotar la escalera', async () => {
    const { pagoId } = await sembrar()
    await programarEscalera(pagoId, ahora)
    const falla = async () => ({ ok: false, motivo: 'card_declined' })

    await ejecutarPendientes(falla, enDias(1.1))
    expect(await accesoActivo()).toBe(true)

    await ejecutarPendientes(falla, enDias(3.1))
    expect(await accesoActivo()).toBe(true)

    await ejecutarPendientes(falla, enDias(7.1))
    expect(await accesoActivo()).toBe(false)
  })

  it('devuelve el acceso en cuanto un cobro entra, con el motivo escrito', async () => {
    const { pagoId } = await sembrar()
    await programarEscalera(pagoId, ahora)
    await ejecutarPendientes(async () => ({ ok: false }), enDias(1.1))
    await ejecutarPendientes(async () => ({ ok: false }), enDias(3.1))
    await ejecutarPendientes(async () => ({ ok: false }), enDias(7.1))
    expect(await accesoActivo()).toBe(false)

    // Paga mas tarde. Se programa una escalera nueva y el primer intento entra.
    const db = getFirestore()
    await db.collection('payments').doc(pagoId).update({ estado: 'fallido' })
    await programarEscalera(pagoId, enDias(10))
    await ejecutarPendientes(async () => ({ ok: true }), enDias(11.1))

    expect(await accesoActivo()).toBe(true)
    const g = await db
      .collection('access_grants')
      .where('member_id', '==', 'uid-ana')
      .where('activo', '==', true)
      .get()
    expect(g.docs[0]!.data()['motivo']).toBe('cobro recuperado')
  })

  it('no reintenta una suscripcion ya cancelada', async () => {
    const { susId, pagoId } = await sembrar()
    await programarEscalera(pagoId, ahora)
    await getFirestore().collection('subscriptions').doc(susId).update({ estado: 'cancelada' })

    let llamadas = 0
    await ejecutarPendientes(async () => {
      llamadas += 1
      return { ok: true }
    }, enDias(1.1))

    expect(llamadas).toBe(0)
  })

  it('no ejecuta un intento antes de que le toque', async () => {
    const { pagoId } = await sembrar()
    await programarEscalera(pagoId, ahora)

    const r = await ejecutarPendientes(async () => ({ ok: true }), enDias(0.5))
    expect(r.revisados).toBe(0)
  })
})
