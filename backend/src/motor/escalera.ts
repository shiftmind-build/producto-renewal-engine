/**
 * La escalera de reintentos. Es el producto.
 *
 * Todo lo demas -- planes, pantallas, listados -- lo tiene cualquiera. Lo que se paga
 * aqui es que cuando la tarjeta de alguien falla un martes a las tres de la manyana,
 * esto lo reintenta el dia 1, el 3 y el 7, le corta el acceso solo al agotarlos, y se
 * lo devuelve en el momento en que un cobro entra. Sin que nadie mire nada.
 *
 * Tres decisiones que parecen detalles y no lo son:
 *
 *  1. El calendario esta AQUI, no en Stripe. Stripe tiene sus propios reintentos y son
 *     una caja negra: no se sabe cuando van a pasar ni se puede explicar a un cliente
 *     por que le cortaron el jueves. Un intento programado en nuestra tabla se puede
 *     enseñar, mover y auditar.
 *
 *  2. Nunca se decide con el tiempo, se decide con el estado. "Han pasado siete dias"
 *     no basta: entre medias puede haber entrado un pago manual, el cliente puede haber
 *     cancelado, o el mismo intento puede haberse ejecutado ya por un reintento del
 *     cron. Cada paso vuelve a leer la fila antes de actuar.
 *
 *  3. El corte de acceso es un hecho con fecha y motivo, no un campo booleano que
 *     alguien pone a false. Cuando un cliente llame preguntando por que no entra, la
 *     respuesta tiene que estar escrita.
 */

import { getFirestore, Timestamp } from 'firebase-admin/firestore'

/** Dia 1, 3 y 7 desde el fallo. Tres intentos y se acaba. */
export const CALENDARIO_DIAS = [1, 3, 7] as const

export type ResultadoIntento = 'pendiente' | 'cobrado' | 'fallido' | 'cancelado'

export type Cobrador = (
  suscripcion: { id: string; stripe_subscription_id?: string },
  importeCentavos: number,
) => Promise<{ ok: boolean; stripe_payment_intent_id?: string; motivo?: string }>

const dia = 24 * 60 * 60 * 1000

/**
 * Programa la escalera entera al fallar un cobro.
 *
 * Se crean los tres de golpe y no uno detras de otro: asi el owner ve desde el minuto
 * cero cuando se va a reintentar y cuando se corta, en vez de descubrirlo cada vez.
 * Y si el proceso programado deja de correr un dia, al volver recupera los atrasados
 * en lugar de haber perdido la cadena.
 */
export async function programarEscalera(paymentId: string, desde = new Date()) {
  const db = getFirestore()
  // Idempotente, pero solo contra una escalera EN CURSO.
  //
  // La primera version miraba si existia cualquier intento para ese pago, y eso tenia
  // una consecuencia que solo se vio al escribir el test: a un cliente que fallo, agoto
  // los tres intentos y meses despues vuelve a fallar, no se le programaba nada. Se le
  // cortaba al primer fallo y sin avisar. Un historial cerrado no es una escalera viva.
  const enCurso = await db
    .collection('dunning_attempts')
    .where('payment_id', '==', paymentId)
    .where('resultado', '==', 'pendiente')
    .limit(1)
    .get()
  if (!enCurso.empty) return { creados: 0, motivo: 'ya hay una escalera en curso' }

  const lote = db.batch()
  CALENDARIO_DIAS.forEach((dias, i) => {
    lote.set(db.collection('dunning_attempts').doc(), {
      payment_id: paymentId,
      numero_intento: i + 1,
      programado_para: Timestamp.fromMillis(desde.getTime() + dias * dia),
      ejecutado_en: null,
      resultado: 'pendiente' satisfies ResultadoIntento,
    })
  })
  await lote.commit()
  return { creados: CALENDARIO_DIAS.length }
}

/**
 * Ejecuta los intentos que ya tocan. Lo llama el proceso programado.
 *
 * Devuelve el recuento para que el cron pueda registrar que hizo. Un cron que no deja
 * rastro de cuantas filas toco es un cron del que nadie sabe si esta vivo.
 */
export async function ejecutarPendientes(cobrar: Cobrador, ahora = new Date()) {
  const db = getFirestore()
  const tocan = await db
    .collection('dunning_attempts')
    .where('resultado', '==', 'pendiente')
    .where('programado_para', '<=', Timestamp.fromDate(ahora))
    .limit(200)
    .get()

  let cobrados = 0
  let fallidos = 0
  let cancelados = 0

  for (const intento of tocan.docs) {
    const { payment_id, numero_intento } = intento.data() as {
      payment_id: string
      numero_intento: number
    }

    const pago = await db.collection('payments').doc(payment_id).get()
    const datosPago = pago.data() as
      | { subscription_id: string; importe_centavos: number; estado: string }
      | undefined

    // El pago pudo entrar por otra via entre que esto se programo y ahora: una tarjeta
    // nueva, un cobro manual del owner. Reintentar entonces seria cobrarle dos veces.
    if (!datosPago || datosPago.estado === 'cobrado') {
      await intento.ref.update({ resultado: 'cancelado', ejecutado_en: Timestamp.fromDate(ahora) })
      cancelados += 1
      continue
    }

    const suscripcion = await db.collection('subscriptions').doc(datosPago.subscription_id).get()
    const datosSus = suscripcion.data() as
      | { estado: string; stripe_subscription_id?: string }
      | undefined
    if (!datosSus || datosSus.estado === 'cancelada') {
      await intento.ref.update({ resultado: 'cancelado', ejecutado_en: Timestamp.fromDate(ahora) })
      cancelados += 1
      continue
    }

    const r = await cobrar(
      { id: suscripcion.id, ...(datosSus.stripe_subscription_id ? { stripe_subscription_id: datosSus.stripe_subscription_id } : {}) },
      datosPago.importe_centavos,
    )

    await intento.ref.update({
      resultado: (r.ok ? 'cobrado' : 'fallido') satisfies ResultadoIntento,
      ejecutado_en: Timestamp.fromDate(ahora),
    })

    if (r.ok) {
      cobrados += 1
      await db.collection('payments').doc(payment_id).update({
        estado: 'cobrado',
        ...(r.stripe_payment_intent_id ? { stripe_payment_intent_id: r.stripe_payment_intent_id } : {}),
      })
      // Entra un cobro: se cancelan los intentos que quedaban y vuelve el acceso.
      await cancelarRestantes(payment_id, ahora)
      await concederAcceso(datosPago.subscription_id, 'cobro recuperado', ahora)
    } else {
      fallidos += 1
      // Solo el ultimo peldanyo corta. Los anteriores no tocan el acceso: cortar en el
      // primer fallo y devolverlo al segundo intento es peor experiencia que esperar.
      if (numero_intento === CALENDARIO_DIAS.length) {
        await revocarAcceso(datosPago.subscription_id, `escalera agotada tras ${numero_intento} intentos`, ahora)
      }
    }
  }

  return { revisados: tocan.size, cobrados, fallidos, cancelados }
}

async function cancelarRestantes(paymentId: string, ahora: Date) {
  const db = getFirestore()
  const quedan = await db
    .collection('dunning_attempts')
    .where('payment_id', '==', paymentId)
    .where('resultado', '==', 'pendiente')
    .get()
  if (quedan.empty) return
  const lote = db.batch()
  quedan.docs.forEach((d) =>
    lote.update(d.ref, { resultado: 'cancelado', ejecutado_en: Timestamp.fromDate(ahora) }),
  )
  await lote.commit()
}

/**
 * El acceso se lleva como historial, no como interruptor.
 *
 * Un booleano `activo` responde "puede entrar?" y nada mas. Cuando el cliente llame
 * enfadado preguntando desde cuando y por que, con un booleano no hay respuesta.
 */
async function revocarAcceso(subscriptionId: string, motivo: string, ahora: Date) {
  const db = getFirestore()
  const sus = await db.collection('subscriptions').doc(subscriptionId).get()
  const memberId = (sus.data() as { member_id?: string } | undefined)?.member_id
  if (!memberId) return

  const vigente = await db
    .collection('access_grants')
    .where('member_id', '==', memberId)
    .where('activo', '==', true)
    .get()
  if (vigente.empty) return

  const lote = db.batch()
  vigente.docs.forEach((d) =>
    lote.update(d.ref, { activo: false, revocado_en: Timestamp.fromDate(ahora), motivo }),
  )
  await lote.commit()
}

async function concederAcceso(subscriptionId: string, motivo: string, ahora: Date) {
  const db = getFirestore()
  const sus = await db.collection('subscriptions').doc(subscriptionId).get()
  const memberId = (sus.data() as { member_id?: string } | undefined)?.member_id
  if (!memberId) return

  const vigente = await db
    .collection('access_grants')
    .where('member_id', '==', memberId)
    .where('activo', '==', true)
    .limit(1)
    .get()
  if (!vigente.empty) return

  await db.collection('access_grants').add({
    member_id: memberId,
    activo: true,
    concedido_en: Timestamp.fromDate(ahora),
    revocado_en: null,
    motivo,
  })
}
