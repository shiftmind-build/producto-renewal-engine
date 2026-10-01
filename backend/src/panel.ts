import type { Express, Request, Response } from 'express'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { asyncHandler } from './lib/asyncHandler.js'
import { requireRole } from './lib/auth.js'

/**
 * Las lecturas del panel del duenyo.
 *
 * Viven aparte de rutas.ts porque hacen algo distinto: no guardan nada, componen. Una
 * suscripcion en Firestore es `member_id` + `plan_id` + `estado`, y eso en una pantalla
 * son tres identificadores que no dicen nada. El trabajo de estas rutas es convertir eso
 * en el nombre del cliente, el nombre del plan y cuanto dinero hay en juego.
 *
 * Tres cosas que se deciden aqui y conviene que esten dichas:
 *
 *   1. Los nombres salen de Firebase Auth, no de una coleccion de miembros -- no existe,
 *      y no la vamos a inventar para esto. Si el usuario ya no esta, se ensena su id en
 *      vez de un hueco: un hueco parece un fallo del producto.
 *
 *   2. Todo lleva tope. Un panel que intenta leer cincuenta mil filas no es lento, es una
 *      pantalla en blanco con un error de tiempo, y justo el cliente al que mas le
 *      importa el panel es el que mas filas tiene.
 *
 *   3. Ninguna consulta de aqui combina `where` con `orderBy` sobre campos distintos.
 *      El emulador no exige indices compuestos y produccion si, asi que una consulta de
 *      esas pasa todos los tests y devuelve un 500 al primer usuario real. Lo que hay
 *      que ordenar se ordena en memoria, sobre un conjunto ya acotado.
 */

/** Cuanto vale un plan al mes. Un anual cuenta como un doceavo o enero miente. */
function mensual(precioCentavos: number, intervalo: unknown) {
  return intervalo === 'anyo' ? Math.round(precioCentavos / 12) : precioCentavos
}

function numero(v: unknown) {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

function texto(v: unknown) {
  return typeof v === 'string' ? v : ''
}

/**
 * El nombre de cada miembro, en una sola llamada.
 *
 * `getUsers` acepta cien por tanda. Pedirlos de uno en uno dentro del bucle convierte un
 * panel de cincuenta filas en cincuenta viajes de ida y vuelta.
 */
async function nombresDe(uids: string[]): Promise<Map<string, string>> {
  const nombres = new Map<string, string>()
  const unicos = [...new Set(uids.filter(Boolean))]
  for (let i = 0; i < unicos.length; i += 100) {
    const tanda = unicos.slice(i, i + 100).map((uid) => ({ uid }))
    try {
      const { users } = await getAuth().getUsers(tanda)
      for (const u of users) nombres.set(u.uid, u.displayName || u.email || u.uid)
    } catch (err) {
      // Que falle el directorio no puede dejar al duenyo sin panel. Se sigue con los ids.
      console.error('[panel] no se pudieron leer los nombres', err)
    }
  }
  for (const uid of unicos) if (!nombres.has(uid)) nombres.set(uid, uid)
  return nombres
}

type PlanLeido = {
  id: string
  nombre: string
  precio_centavos: number
  moneda: string
  intervalo: 'mes' | 'anyo'
}

async function planesPorId(): Promise<Map<string, PlanLeido>> {
  const db = getFirestore()
  const snap = await db.collection('plans').limit(200).get()
  const mapa = new Map<string, PlanLeido>()
  for (const d of snap.docs) {
    const p = d.data()
    mapa.set(d.id, {
      id: d.id,
      nombre: texto(p['nombre']) || d.id,
      precio_centavos: numero(p['precio_centavos']),
      moneda: texto(p['moneda']) || 'USD',
      intervalo: p['intervalo'] === 'anyo' ? 'anyo' : 'mes',
    })
  }
  return mapa
}

const TOPE_SUSCRIPCIONES = 500

export function montaPanel(app: Express) {
  /**
   * Quien esta a punto de perderse, con todo lo que hace falta para decidir hoy.
   *
   * "En riesgo" significa una cosa concreta: tiene una escalera viva. Una suscripcion
   * con los tres peldanyos agotados no esta en riesgo, esta perdida, y sumarla al mismo
   * numero hace que el numero deje de servir para nada.
   */
  app.get(
    '/panel/en-riesgo',
    requireRole(['owner', 'staff']),
    asyncHandler(async (_req: Request, res: Response) => {
      const db = getFirestore()
      const vivos = await db
        .collection('dunning_attempts')
        .where('resultado', '==', 'pendiente')
        .limit(200)
        .get()

      // El peldanyo que toca de cada pago es el pendiente mas proximo, no el primero que
      // devuelva Firestore. Se ordena en memoria: el conjunto ya esta acotado a 200.
      const porPago = new Map<string, { peldanyo: number; cuando: unknown }>()
      for (const d of vivos.docs) {
        const a = d.data()
        const pago = texto(a['payment_id'])
        if (!pago) continue
        const peldanyo = numero(a['numero_intento'])
        const actual = porPago.get(pago)
        if (!actual || peldanyo < actual.peldanyo) {
          porPago.set(pago, { peldanyo, cuando: a['programado_para'] })
        }
      }

      const planes = await planesPorId()
      const filas: Array<Record<string, unknown>> = []

      for (const [pagoId, intento] of porPago) {
        const pago = await db.collection('payments').doc(pagoId).get()
        if (!pago.exists) continue
        const subId = texto(pago.data()!['subscription_id'])
        const sub = subId ? await db.collection('subscriptions').doc(subId).get() : null
        if (!sub?.exists) continue
        const s = sub.data()!
        const plan = planes.get(texto(s['plan_id']))
        filas.push({
          suscripcion_id: sub.id,
          member_id: texto(s['member_id']),
          plan_nombre: plan?.nombre ?? texto(s['plan_id']),
          mrr_centavos: plan ? mensual(plan.precio_centavos, plan.intervalo) : 0,
          peldanyo: intento.peldanyo,
          proximo_intento: intento.cuando,
          // Vacio cuando no lo tenemos. Poner 'card_declined' por defecto seria
          // inventarse el motivo de un cobro fallido, y el duenyo lo usaria para
          // decidir a quien llama. El esquema de `payments` no guarda el motivo
          // todavia; cuando lo guarde, este campo se llena solo.
          motivo: texto(pago.data()!['motivo_fallo']),
        })
      }

      const nombres = await nombresDe(filas.map((f) => String(f['member_id'])))
      for (const f of filas) f['member_nombre'] = nombres.get(String(f['member_id']))

      filas.sort((a, b) => Number(a['peldanyo']) - Number(b['peldanyo']))
      res.status(200).json({ en_riesgo: filas.length, filas })
    }),
  )

  /** Todas, en cualquier estado. Canceladas y vencidas siguen en la lista a proposito. */
  app.get(
    '/panel/suscripciones',
    requireRole(['owner', 'staff']),
    asyncHandler(async (_req: Request, res: Response) => {
      const db = getFirestore()
      const [snap, planes] = await Promise.all([
        db.collection('subscriptions').limit(TOPE_SUSCRIPCIONES).get(),
        planesPorId(),
      ])

      const nombres = await nombresDe(snap.docs.map((d) => texto(d.data()['member_id'])))

      const suscripciones = snap.docs.map((d) => {
        const s = d.data()
        const plan = planes.get(texto(s['plan_id']))
        const viva = s['estado'] === 'activa' || s['estado'] === 'en_gracia' || s['estado'] === 'reintentando'
        return {
          id: d.id,
          member_id: texto(s['member_id']),
          member_nombre: nombres.get(texto(s['member_id'])) ?? texto(s['member_id']),
          plan_id: texto(s['plan_id']),
          plan_nombre: plan?.nombre ?? texto(s['plan_id']),
          estado: texto(s['estado']) || 'activa',
          periodo_fin: s['periodo_fin'],
          // Una cancelada no aporta ingreso. Contarla infla el panel y el duenyo acaba
          // descubriendolo el dia que compara con lo que entra de verdad en el banco.
          mrr_centavos: viva && plan ? mensual(plan.precio_centavos, plan.intervalo) : 0,
        }
      })

      res.status(200).json({ suscripciones })
    }),
  )

  /** Los planes, con cuanta gente hay en cada uno. */
  app.get(
    '/panel/planes',
    requireRole(['owner', 'staff']),
    asyncHandler(async (_req: Request, res: Response) => {
      const db = getFirestore()
      const [planes, snap] = await Promise.all([
        planesPorId(),
        db.collection('subscriptions').limit(TOPE_SUSCRIPCIONES).get(),
      ])

      // Una sola lectura y un recuento en memoria. Una consulta por plan son N viajes
      // para contar lo mismo, y encima cada una necesitaria su indice.
      const activos = new Map<string, number>()
      for (const d of snap.docs) {
        const s = d.data()
        if (s['estado'] !== 'activa') continue
        const id = texto(s['plan_id'])
        activos.set(id, (activos.get(id) ?? 0) + 1)
      }

      res.status(200).json({
        planes: [...planes.values()].map((p) => ({ ...p, activos: activos.get(p.id) ?? 0 })),
      })
    }),
  )

  /** Una suscripcion entera: su escalera, sus pagos y si el acceso esta cortado. */
  app.get(
    '/panel/suscripcion/:id',
    requireRole(['owner', 'staff']),
    asyncHandler(async (req: Request, res: Response) => {
      const db = getFirestore()
      const id = String(req.params['id'])
      const sub = await db.collection('subscriptions').doc(id).get()
      if (!sub.exists) {
        res.status(404).json({ error: 'esa suscripcion no existe' })
        return
      }
      const s = sub.data()!
      const memberId = texto(s['member_id'])

      const [planes, pagosSnap, concesiones] = await Promise.all([
        planesPorId(),
        db.collection('payments').where('subscription_id', '==', id).limit(50).get(),
        db.collection('access_grants').where('member_id', '==', memberId).limit(20).get(),
      ])
      const plan = planes.get(texto(s['plan_id']))

      const pagos = pagosSnap.docs
        .map((d) => {
          const p = d.data()
          return {
            id: d.id,
            importe_centavos: numero(p['importe_centavos']),
            moneda: texto(p['moneda']) || 'USD',
            creado_en: p['creado_en'],
            estado: p['estado'] === 'cobrado' ? 'cobrado' : 'fallido',
            motivo: texto(p['motivo_fallo']) || undefined,
          }
        })
        // En memoria y no con orderBy: `where` + `orderBy` sobre campos distintos exige
        // un indice compuesto que el emulador no pide y produccion si.
        .sort((a, b) => segundos(b.creado_en) - segundos(a.creado_en))

      const intentos = (
        await Promise.all(
          pagosSnap.docs.map((d) =>
            db.collection('dunning_attempts').where('payment_id', '==', d.id).limit(10).get(),
          ),
        )
      )
        .flatMap((snap) =>
          snap.docs.map((d) => {
            const a = d.data()
            return {
              id: d.id,
              peldanyo: numero(a['numero_intento']),
              programado_para: a['programado_para'],
              resultado: texto(a['resultado']) || 'pendiente',
              motivo: texto(a['motivo']) || undefined,
            }
          }),
        )
        .sort((a, b) => segundos(a.programado_para) - segundos(b.programado_para))

      const nombres = await nombresDe([memberId])
      // El acceso se corta solo tras el tercer peldanyo. Si hay alguna concesion activa,
      // no esta cortado -- se mira el estado real y no se deduce del estado del cobro.
      const revocado =
        concesiones.size > 0 && concesiones.docs.every((d) => d.data()['activo'] === false)

      res.status(200).json({
        suscripcion: {
          id: sub.id,
          member_id: memberId,
          member_nombre: nombres.get(memberId) ?? memberId,
          plan_id: texto(s['plan_id']),
          plan_nombre: plan?.nombre ?? texto(s['plan_id']),
          estado: texto(s['estado']) || 'activa',
          periodo_fin: s['periodo_fin'],
          mrr_centavos: plan ? mensual(plan.precio_centavos, plan.intervalo) : 0,
        },
        pagos,
        intentos,
        acceso_revocado: revocado,
      })
    }),
  )
}

/** Firestore devuelve Timestamp, el emulador a veces un objeto plano. Los dos valen. */
function segundos(t: unknown): number {
  if (t && typeof t === 'object') {
    const o = t as { _seconds?: number; seconds?: number; toMillis?: () => number }
    if (typeof o.toMillis === 'function') return Math.floor(o.toMillis() / 1000)
    if (typeof o._seconds === 'number') return o._seconds
    if (typeof o.seconds === 'number') return o.seconds
  }
  return 0
}
