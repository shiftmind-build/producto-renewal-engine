import type { Express, Request, Response } from 'express'
import { getFirestore } from 'firebase-admin/firestore'
import { asyncHandler } from './lib/asyncHandler.js'
import { requireRole, verificarAuth } from './lib/auth.js'
import { ejecutarPendientes, programarEscalera, type Cobrador } from './motor/escalera.js'

/**
 * Las rutas. Nada llega a Firestore sin pasar antes por auth y por rol.
 *
 * Y una separacion que importa: lo que dispara el proceso programado NO es una ruta de
 * usuario. Lleva su propio secreto de cabecera y no acepta un token de sesion, porque
 * un endpoint que mueve dinero y que ademas puede llamar cualquiera con una cuenta es
 * un endpoint que alguien acabara llamando en bucle.
 */

function secretoValido(req: Request) {
  const esperado = process.env['CRON_SECRET']
  // Sin secreto configurado, cerrado. Nunca abierto por omision: un despliegue al que
  // se le olvido la variable no puede convertirse en una puerta abierta.
  if (!esperado) return false
  return req.header('x-cron-secret') === esperado
}

/**
 * El cobrador de verdad se inyecta desde fuera.
 *
 * Asi el motor se prueba sin tocar Stripe, y el dia que el cliente quiera otra pasarela
 * se cambia esta funcion y no el motor.
 */
export function montaRutas(app: Express, cobrar: Cobrador) {
  // --- proceso programado -------------------------------------------------------
  app.post(
    '/tareas/escalera',
    asyncHandler(async (req: Request, res: Response) => {
      if (!secretoValido(req)) {
        res.status(401).json({ error: 'no autorizado' })
        return
      }
      const r = await ejecutarPendientes(cobrar)
      console.log('[escalera]', JSON.stringify(r))
      res.status(200).json(r)
    }),
  )

  // --- webhook de la pasarela ---------------------------------------------------
  app.post(
    '/webhook/pago-fallido',
    asyncHandler(async (req: Request, res: Response) => {
      if (!secretoValido(req)) {
        res.status(401).json({ error: 'no autorizado' })
        return
      }
      const paymentId = String((req.body as { payment_id?: unknown })?.payment_id ?? '')
      if (!paymentId) {
        res.status(400).json({ error: 'falta payment_id' })
        return
      }
      // Idempotente: la pasarela entrega el mismo evento mas de una vez y eso es normal.
      res.status(200).json(await programarEscalera(paymentId))
    }),
  )

  // --- lo que ve un miembro de si mismo -----------------------------------------
  app.get(
    '/mi/suscripcion',
    asyncHandler(async (req: Request, res: Response) => {
      const quien = await verificarAuth(req)
      const db = getFirestore()
      const suyas = await db
        .collection('subscriptions')
        .where('member_id', '==', quien.uid)
        .limit(1)
        .get()
      if (suyas.empty) {
        res.status(404).json({ error: 'sin suscripcion' })
        return
      }
      const sus = suyas.docs[0]!
      const pagos = await db
        .collection('payments')
        .where('subscription_id', '==', sus.id)
        .orderBy('creado_en', 'desc')
        .limit(12)
        .get()
      res.status(200).json({
        suscripcion: { id: sus.id, ...sus.data() },
        pagos: pagos.docs.map((d) => ({ id: d.id, ...d.data() })),
      })
    }),
  )

  // --- lo que ve el duenyo del negocio ------------------------------------------
  app.get(
    '/panel/en-riesgo',
    requireRole(['owner', 'staff']),
    asyncHandler(async (_req: Request, res: Response) => {
      const db = getFirestore()
      // En riesgo = tiene una escalera viva. No "lleva un pago fallido": un fallo con
      // los reintentos ya agotados no esta en riesgo, esta perdido, y mezclarlos hace
      // que el panel deje de significar nada.
      const vivos = await db
        .collection('dunning_attempts')
        .where('resultado', '==', 'pendiente')
        .limit(200)
        .get()
      const pagos = [...new Set(vivos.docs.map((d) => d.data()['payment_id'] as string))]
      res.status(200).json({ en_riesgo: pagos.length, pagos })
    }),
  )
}
