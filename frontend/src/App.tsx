import { useEffect, useState } from 'react'
import { api, ErrorApi } from './api'
import { Estado, Marco, Tabla, Tarjeta } from './piezas'

/**
 * El panel del Renewal Engine.
 *
 * Lo que decide si esta pantalla vale algo no es lo que ensena, es lo que NO ensena.
 * Un panel de suscripciones que lista las mil y deja al dueno buscando es un listado;
 * uno que abre con las siete que estan a punto de perderse es una herramienta.
 *
 * Por eso lo primero y mas grande es "en riesgo", y el listado completo esta detras.
 */

type Suscripcion = {
  id: string
  member_id: string
  plan_id: string
  estado: string
  periodo_fin?: { _seconds?: number }
}

type EnRiesgo = { en_riesgo: number; pagos: string[] }

function fecha(t?: { _seconds?: number }) {
  if (!t?._seconds) return '—'
  return new Date(t._seconds * 1000).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

/** El estado se lee por palabra, no solo por color. */
function pinta(estado: string): 'bien' | 'aviso' | 'mal' | 'neutro' {
  if (estado === 'activa') return 'bien'
  if (estado === 'en_gracia' || estado === 'reintentando') return 'aviso'
  if (estado === 'cancelada' || estado === 'vencida') return 'mal'
  return 'neutro'
}

export default function App() {
  const [riesgo, setRiesgo] = useState<EnRiesgo>()
  const [suscripciones, setSuscripciones] = useState<Suscripcion[]>()
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)

  const token = new URLSearchParams(location.search).get('t') ?? ''

  useEffect(() => {
    let vivo = true
    ;(async () => {
      try {
        const r = await api<EnRiesgo>('/panel/en-riesgo', { token })
        if (vivo) setRiesgo(r)
      } catch (e) {
        // El error se ensena entero, con lo que hay que hacer. Nunca "algo fallo".
        if (vivo) setError(e instanceof ErrorApi ? e.message : 'Could not reach the server.')
      } finally {
        if (vivo) setCargando(false)
      }
    })()
    return () => {
      vivo = false
    }
  }, [token])

  return (
    <Marco
      nombre="Renewal Engine"
      nav={
        <>
          <a href="#riesgo" aria-current="page">
            At risk
          </a>
          <a href="#miembros">Members</a>
          <a href="#planes">Plans</a>
        </>
      }
    >
      <h1>Recurring revenue</h1>
      <p style={{ color: 'var(--tinta-suave)', maxWidth: '58ch' }}>
        What matters here is the money that is about to stop arriving, not the money that is
        already arriving. Everything below the first block is history.
      </p>

      {error && (
        <div className="error" style={{ marginTop: 'var(--hueco)' }}>
          <strong>{error}</strong>
          {/* Un error sin salida deja a la persona atascada mirando la pantalla. */}
          <p style={{ margin: '8px 0 0' }}>
            <button className="boton secundario" onClick={() => location.reload()}>
              Try again
            </button>
          </p>
        </div>
      )}

      <section id="riesgo" style={{ marginTop: 'var(--hueco-l)' }}>
        <div className="fila" style={{ alignItems: 'stretch' }}>
          <Tarjeta titulo="At risk right now">
            <p
              className="cifra"
              style={{
                fontSize: '2.6rem',
                fontFamily: 'var(--fuente-titular)',
                fontWeight: 'var(--peso-titular)',
                margin: '4px 0 0',
                color: riesgo && riesgo.en_riesgo > 0 ? 'var(--aviso)' : 'var(--tinta)',
              }}
            >
              {cargando ? '—' : (riesgo?.en_riesgo ?? 0)}
            </p>
            <p style={{ margin: 0, color: 'var(--tinta-suave)', fontSize: '0.85rem' }}>
              {/* "En riesgo" significa una cosa concreta y se dice: con reintentos vivos.
                  Sin esta frase, el numero se interpreta como cada uno quiera. */}
              subscriptions with a retry still in flight
            </p>
          </Tarjeta>

          <Tarjeta titulo="What happens next">
            <p style={{ margin: '4px 0 0', fontSize: '0.9rem', lineHeight: 1.6 }}>
              A failed card is retried on <strong>day 1, 3 and 7</strong>. Access is cut only
              after the third, and comes back the moment a charge succeeds.
            </p>
          </Tarjeta>
        </div>
      </section>

      <section id="miembros" style={{ marginTop: 'var(--hueco-l)' }}>
        <h2>Members</h2>
        <div style={{ marginTop: 'var(--hueco-s)' }}>
          <Tabla
            columnas={['Member', 'Plan', 'Status', 'Renews']}
            filas={suscripciones}
            cargando={cargando}
            error={null}
            vacio="No subscriptions yet. They appear here the moment somebody signs up."
            fila={(s) => (
              <tr key={s.id}>
                <td>{s.member_id}</td>
                <td>{s.plan_id}</td>
                <td>
                  <Estado tipo={pinta(s.estado)}>{s.estado}</Estado>
                </td>
                <td className="cifra">{fecha(s.periodo_fin)}</td>
              </tr>
            )}
          />
        </div>
      </section>
    </Marco>
  )
}
