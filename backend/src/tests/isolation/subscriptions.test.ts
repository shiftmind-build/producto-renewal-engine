import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { readFileSync } from 'node:fs'

/**
 * Aislamiento de subscriptions. Obligatorio y bloqueante: corre en el hook pre-push.
 *
 * Lo que comprueba no es que la aplicacion funcione, es que NO funciona para quien no
 * debe. Un usuario que consigue leer la fila de otro es el fallo mas caro de un MVP y
 * el que no da ninguna senyal hasta que alguien lo descubre.
 *
 * Generado desde el bloque `acceso` de blueprint.yaml -- no se edita a mano: se cambia
 * el blueprint y se vuelve a generar, o la regla y el test dejan de hablar de lo mismo.
 */
describe('aislamiento: subscriptions', () => {
  let ctx: RulesTestEnvironment

  beforeAll(async () => {
    ctx = await initializeTestEnvironment({
      projectId: 'shiftmind-renewal-engine',
      firestore: {
        rules: readFileSync('firestore.rules', 'utf8'),
        host: '127.0.0.1',
        port: 8080,
      },
    })
  })

  afterAll(async () => {
    await ctx.cleanup()
  })

  beforeEach(async () => {
    await ctx.clearFirestore()
    await ctx.withSecurityRulesDisabled(async (libre) => {
      await libre.firestore().doc('subscriptions/d1').set({
      'member_id': 'uid-a',
      'plan_id': 'x',
      'estado': 'x',
      'periodo_fin': 'x',
      'cancelada_en': 'x',
      'stripe_subscription_id': 'x'
})
    })
  })

  it('el duenyo lee su propia fila', async () => {
    const a = ctx.authenticatedContext('uid-a', { role: 'owner' })
    await assertSucceeds(a.firestore().doc('subscriptions/d1').get())
  })

  it('sin sesion no se lee nada', async () => {
    const fuera = ctx.unauthenticatedContext()
    await assertFails(fuera.firestore().doc('subscriptions/d1').get())
  })

  it('owner SI lee la fila, como declara el blueprint', async () => {
    const rol = ctx.authenticatedContext('uid-b', { role: 'owner' })
    await assertSucceeds(rol.firestore().doc('subscriptions/d1').get())
  })

  it('staff SI lee la fila, como declara el blueprint', async () => {
    const rol = ctx.authenticatedContext('uid-b', { role: 'staff' })
    await assertSucceeds(rol.firestore().doc('subscriptions/d1').get())
  })

  it('member NO lee la fila de otro', async () => {
    const otro = ctx.authenticatedContext('uid-b', { role: 'member' })
    await assertFails(otro.firestore().doc('subscriptions/d1').get())
  })

  it('un tercero no puede modificar ni borrar la fila de otro', async () => {
    const otro = ctx.authenticatedContext('uid-c', { role: 'member' })
    await assertFails(otro.firestore().doc('subscriptions/d1').update({ estado: 'pirateado' }))
    await assertFails(otro.firestore().doc('subscriptions/d1').delete())
  })
})
