import { z } from 'zod'

/**
 * Los campos declarados en el blueprint, y solo esos.
 *
 * `.strict()` no es cosmetico: sin el, un cliente puede colar un campo extra --
 * `role`, `owner_id`, `estado` -- que ninguna regla mira porque nadie sabia que
 * existia. Rechazar lo no declarado es lo que hace que la lista de campos signifique
 * algo.
 *
 * Los tipos concretos se afinan al escribir el motor de este producto; lo que esta
 * fijado desde el blueprint es QUE campos existen.
 */
export const esquemaPayments = z
  .object({
  subscription_id: z.unknown(),
  importe_centavos: z.unknown(),
  moneda: z.unknown(),
  estado: z.unknown(),
  intento: z.unknown(),
  stripe_payment_intent_id: z.unknown(),
  creado_en: z.unknown(),
  })
  .strict()

export type Payments = z.infer<typeof esquemaPayments>
