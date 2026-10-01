import { useEffect, useState } from 'react'
import { api, ErrorApi } from './api'
import { AvisoDemo, Dato, Estado as Pastilla, Marco, Panel, Pestanas, Tabla, Tarjeta } from './piezas'
import type { Detalle, EnRiesgo, Estado, Plan, Suscripcion } from './tipos'

/**
 * El panel del Renewal Engine.
 *
 * Lo que decide si esta pantalla vale algo no es lo que ensena, es lo que NO ensena.
 * Un panel de suscripciones que lista las mil y deja al dueno buscando es un listado;
 * uno que abre con las dos que estan a punto de perderse es una herramienta.
 *
 * Por eso lo primero y mas grande es "en riesgo", y el listado completo esta detras.
 *
 * "En riesgo" significa una cosa concreta: tiene reintentos vivos. Una suscripcion con
 * los tres peldanyos agotados no esta en riesgo, esta perdida, y meterla en el mismo
 * numero hace que el numero deje de servir para decidir nada.
 */

const VISTAS = [
  ['riesgo', 'At risk'],
  ['suscripciones', 'Subscriptions'],
  ['planes', 'Plans'],
] as const

type Vista = (typeof VISTAS)[number][0]

function fecha(t?: { _seconds?: number }) {
  if (!t?._seconds) return '—'
  return new Date(t._seconds * 1000).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function dinero(centavos: number, moneda = 'USD') {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: moneda,
    maximumFractionDigits: 0,
  }).format(centavos / 100)
}

/** El estado se lee por palabra, no solo por color. */
function pinta(estado: Estado): 'bien' | 'aviso' | 'mal' | 'neutro' {
  if (estado === 'activa') return 'bien'
  if (estado === 'en_gracia' || estado === 'reintentando') return 'aviso'
  if (estado === 'cancelada' || estado === 'vencida') return 'mal'
  return 'neutro'
}

/**
 * Los estados viajan en espanol porque asi se llaman en el backend y en las reglas de
 * Firestore. En la pantalla no: un panel que le ensena "reintentando" a un cliente
 * ingles no es bilingue, esta a medio terminar.
 */
const ESTADOS: Record<Estado, string> = {
  activa: 'active',
  en_gracia: 'in grace',
  reintentando: 'retrying',
  cancelada: 'cancelled',
  vencida: 'lapsed',
}

/** Las razones del banco en ingles de persona. Nadie fuera de pagos sabe que es un 51. */
const MOTIVOS: Record<string, string> = {
  insufficient_funds: 'Not enough funds',
  expired_card: 'Card expired',
  card_declined: 'Card declined',
  do_not_honor: 'Bank refused it',
}
const motivo = (m?: string) => (m ? (MOTIVOS[m] ?? m.replace(/_/g, ' ')) : '—')

/** Un hook por peticion. Devuelve siempre los tres estados, nunca dos. */
function useCarga<T>(ruta: string | null, token: string) {
  const [dato, setDato] = useState<T>()
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(ruta !== null)

  useEffect(() => {
    if (!ruta) {
      setDato(undefined)
      setCargando(false)
      return
    }
    let vivo = true
    setCargando(true)
    setError(null)
    ;(async () => {
      try {
        const r = await api<T>(ruta, { token })
        if (vivo) setDato(r)
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
  }, [ruta, token])

  return { dato, error, cargando }
}

function Error({ texto }: { texto: string }) {
  return (
    <div className="error" style={{ marginTop: 'var(--hueco)' }}>
      <strong>{texto}</strong>
      {/* Un error sin salida deja a la persona atascada mirando la pantalla. */}
      <p style={{ margin: '8px 0 0' }}>
        <button className="boton secundario" onClick={() => location.reload()}>
          Try again
        </button>
      </p>
    </div>
  )
}

/* ------------------------------------------------------------------ pantallas */

function EnRiesgoVista({ token, abre }: { token: string; abre: (id: string) => void }) {
  const { dato, error, cargando } = useCarga<EnRiesgo>('/panel/en-riesgo', token)

  return (
    <>
      <h1>Recurring revenue</h1>
      <p style={{ color: 'var(--tinta-suave)', maxWidth: '58ch' }}>
        What matters here is the money that is about to stop arriving, not the money that is
        already arriving. Everything below the first block is history.
      </p>

      {error && <Error texto={error} />}

      <div className="fila" style={{ alignItems: 'stretch', marginTop: 'var(--hueco-l)' }}>
        <Tarjeta titulo="At risk right now">
          <p
            className="cifra"
            style={{
              fontSize: '2.6rem',
              fontFamily: 'var(--fuente-titular)',
              fontWeight: 'var(--peso-titular)',
              margin: '4px 0 0',
              color: dato && dato.en_riesgo > 0 ? 'var(--aviso)' : 'var(--tinta)',
            }}
          >
            {cargando ? '—' : (dato?.en_riesgo ?? 0)}
          </p>
          <p style={{ margin: 0, color: 'var(--tinta-suave)', fontSize: '0.85rem' }}>
            subscriptions with a retry still in flight
          </p>
        </Tarjeta>

        <Tarjeta titulo="Revenue in the balance">
          <p
            className="cifra"
            style={{
              fontSize: '2.6rem',
              fontFamily: 'var(--fuente-titular)',
              fontWeight: 'var(--peso-titular)',
              margin: '4px 0 0',
            }}
          >
            {cargando
              ? '—'
              : dinero((dato?.filas ?? []).reduce((suma, f) => suma + f.mrr_centavos, 0))}
          </p>
          <p style={{ margin: 0, color: 'var(--tinta-suave)', fontSize: '0.85rem' }}>
            per month, if none of them recover
          </p>
        </Tarjeta>

        <Tarjeta titulo="What happens next">
          <p style={{ margin: '4px 0 0', fontSize: '0.9rem', lineHeight: 1.6 }}>
            A failed card is retried on <strong>day 1, 3 and 7</strong>. Access is cut only
            after the third, and comes back the moment a charge succeeds.
          </p>
        </Tarjeta>
      </div>

      <h2 style={{ marginTop: 'var(--hueco-l)' }}>Who is at risk</h2>
      <div style={{ marginTop: 'var(--hueco-s)' }}>
        <Tabla
          columnas={['Customer', 'Plan', 'Monthly', 'Why it failed', 'Next retry', '']}
          filas={dato?.filas}
          cargando={cargando}
          error={null}
          vacio="Nobody is at risk. Every subscription charged cleanly."
          fila={(f) => (
            <tr key={f.suscripcion_id}>
              <td>{f.member_nombre}</td>
              <td>{f.plan_nombre}</td>
              <td className="cifra">{dinero(f.mrr_centavos)}</td>
              <td>{motivo(f.motivo)}</td>
              <td>
                {/* El peldanyo importa tanto como la fecha: en el tercero se corta el
                    acceso, y eso cambia lo que el dueno quiere hacer hoy. */}
                <Pastilla tipo={f.peldanyo === 7 ? 'mal' : 'aviso'}>
                  day {f.peldanyo} · {fecha(f.proximo_intento)}
                </Pastilla>
              </td>
              <td>
                <button className="boton secundario" onClick={() => abre(f.suscripcion_id)}>
                  Open
                </button>
              </td>
            </tr>
          )}
        />
      </div>
    </>
  )
}

function SuscripcionesVista({ token, abre }: { token: string; abre: (id: string) => void }) {
  const { dato, error, cargando } = useCarga<{ suscripciones: Suscripcion[] }>(
    '/panel/suscripciones',
    token,
  )

  return (
    <>
      <h1>Subscriptions</h1>
      <p style={{ color: 'var(--tinta-suave)', maxWidth: '58ch' }}>
        Everyone, in every state. Cancelled and lapsed stay on the list on purpose — they are
        the ones worth a message.
      </p>
      {error && <Error texto={error} />}
      <div style={{ marginTop: 'var(--hueco-l)' }}>
        <Tabla
          columnas={['Customer', 'Plan', 'Status', 'Monthly', 'Renews', '']}
          filas={dato?.suscripciones}
          cargando={cargando}
          error={null}
          vacio="No subscriptions yet. They appear here the moment somebody signs up."
          fila={(s) => (
            <tr key={s.id}>
              <td>{s.member_nombre}</td>
              <td>{s.plan_nombre}</td>
              <td>
                <Pastilla tipo={pinta(s.estado)}>{ESTADOS[s.estado]}</Pastilla>
              </td>
              <td className="cifra">{s.mrr_centavos ? dinero(s.mrr_centavos) : '—'}</td>
              <td className="cifra">{fecha(s.periodo_fin)}</td>
              <td>
                <button className="boton secundario" onClick={() => abre(s.id)}>
                  Open
                </button>
              </td>
            </tr>
          )}
        />
      </div>
    </>
  )
}

function PlanesVista({ token }: { token: string }) {
  const { dato, error, cargando } = useCarga<{ planes: Plan[] }>('/panel/planes', token)
  const planes = dato?.planes ?? []
  const mrr = planes.reduce(
    (suma, p) => suma + p.activos * (p.intervalo === 'anyo' ? p.precio_centavos / 12 : p.precio_centavos),
    0,
  )

  return (
    <>
      <h1>Plans</h1>
      <p style={{ color: 'var(--tinta-suave)', maxWidth: '58ch' }}>
        An annual plan counts as a twelfth of its price each month, so the total below is
        comparable with the monthly ones instead of spiking every January.
      </p>
      {error && <Error texto={error} />}

      <div className="fila" style={{ alignItems: 'stretch', marginTop: 'var(--hueco-l)' }}>
        <Tarjeta titulo="Monthly recurring revenue">
          <p
            className="cifra"
            style={{
              fontSize: '2.6rem',
              fontFamily: 'var(--fuente-titular)',
              fontWeight: 'var(--peso-titular)',
              margin: '4px 0 0',
            }}
          >
            {cargando ? '—' : dinero(mrr)}
          </p>
          <p style={{ margin: 0, color: 'var(--tinta-suave)', fontSize: '0.85rem' }}>
            across {planes.reduce((s, p) => s + p.activos, 0)} active subscriptions
          </p>
        </Tarjeta>
      </div>

      <div style={{ marginTop: 'var(--hueco-l)' }}>
        <Tabla
          columnas={['Plan', 'Price', 'Billed', 'Active', 'Monthly value']}
          filas={dato?.planes}
          cargando={cargando}
          error={null}
          vacio="No plans yet. Create one and it shows up here."
          fila={(p) => (
            <tr key={p.id}>
              <td>{p.nombre}</td>
              <td className="cifra">{dinero(p.precio_centavos, p.moneda)}</td>
              <td>{p.intervalo === 'anyo' ? 'yearly' : 'monthly'}</td>
              <td className="cifra">{p.activos}</td>
              <td className="cifra">
                {dinero(
                  p.activos * (p.intervalo === 'anyo' ? p.precio_centavos / 12 : p.precio_centavos),
                  p.moneda,
                )}
              </td>
            </tr>
          )}
        />
      </div>
    </>
  )
}

/* ------------------------------------------------------------------ detalle */

function DetalleSuscripcion({ id, token, cierra }: { id: string; token: string; cierra: () => void }) {
  const { dato, error, cargando } = useCarga<Detalle>(`/panel/suscripcion/${id}`, token)

  return (
    <Panel titulo={dato?.suscripcion.member_nombre ?? 'Subscription'} onCerrar={cierra}>
      {cargando && <div className="cargando">Loading…</div>}
      {error && <div className="error">{error}</div>}
      {dato && (
        <>
          <div className="fila">
            <Dato etiqueta="Plan">{dato.suscripcion.plan_nombre}</Dato>
            <Dato etiqueta="Status">
              <Pastilla tipo={pinta(dato.suscripcion.estado)}>
                {ESTADOS[dato.suscripcion.estado]}
              </Pastilla>
            </Dato>
          </div>
          <div className="fila">
            <Dato etiqueta="Monthly">
              {dato.suscripcion.mrr_centavos ? dinero(dato.suscripcion.mrr_centavos) : '—'}
            </Dato>
            <Dato etiqueta="Period ends">{fecha(dato.suscripcion.periodo_fin)}</Dato>
          </div>

          <Dato etiqueta="Access">
            {dato.acceso_revocado ? (
              <Pastilla tipo="mal">cut off</Pastilla>
            ) : (
              <Pastilla tipo="bien">still on</Pastilla>
            )}
          </Dato>

          <div>
            <p className="etiqueta" style={{ margin: '0 0 6px' }}>
              Retry ladder
            </p>
            <ol className="escalera">
              {dato.intentos.map((i) => (
                <li key={i.id}>
                  <time>
                    day {i.peldanyo} · {fecha(i.programado_para)}
                  </time>
                  <span>
                    <Pastilla
                      tipo={
                        i.resultado === 'cobrado'
                          ? 'bien'
                          : i.resultado === 'fallido'
                            ? 'mal'
                            : 'neutro'
                      }
                    >
                      {i.resultado === 'cobrado'
                        ? 'charged'
                        : i.resultado === 'fallido'
                          ? 'failed'
                          : 'scheduled'}
                    </Pastilla>
                    {i.motivo && (
                      <span style={{ color: 'var(--tinta-suave)' }}> · {motivo(i.motivo)}</span>
                    )}
                  </span>
                </li>
              ))}
            </ol>
            {/*
              La frase que explica por que la escalera se para. Sin ella, ver un dia 7
              "scheduled" despues de un dia 3 "charged" parece un fallo del producto.
            */}
            <p style={{ margin: '8px 0 0', fontSize: '0.8rem', color: 'var(--tinta-suave)' }}>
              The ladder stops the moment one of them charges. Access is only cut after the
              third fails, and comes back on the next success.
            </p>
          </div>

          <div>
            <p className="etiqueta" style={{ margin: '0 0 6px' }}>
              Payments
            </p>
            <ol className="escalera">
              {dato.pagos.map((p) => (
                <li key={p.id}>
                  <time>{fecha(p.creado_en)}</time>
                  <span>
                    <Pastilla tipo={p.estado === 'cobrado' ? 'bien' : 'mal'}>
                      {dinero(p.importe_centavos)}
                    </Pastilla>
                    {p.motivo && (
                      <span style={{ color: 'var(--tinta-suave)' }}> · {motivo(p.motivo)}</span>
                    )}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </>
      )}
    </Panel>
  )
}

/* ------------------------------------------------------------------ app */

export default function App() {
  const [vista, setVista] = useState<Vista>('riesgo')
  const [abierta, setAbierta] = useState<string | null>(null)

  const token = new URLSearchParams(location.search).get('t') ?? ''

  return (
    <Marco
      nombre="Renewal Engine"
      nav={<Pestanas vistas={VISTAS} activa={vista} onCambio={setVista} />}
    >
      <AvisoDemo>
        Seven invented subscriptions. Two of them are mid-retry, one recovered on its own, and
        one ran out of retries — open any of them to see the ladder.
      </AvisoDemo>

      <div className="con-detalle">
        <div>
          {vista === 'riesgo' && <EnRiesgoVista token={token} abre={setAbierta} />}
          {vista === 'suscripciones' && <SuscripcionesVista token={token} abre={setAbierta} />}
          {vista === 'planes' && <PlanesVista token={token} />}
        </div>
        {abierta && (
          <DetalleSuscripcion id={abierta} token={token} cierra={() => setAbierta(null)} />
        )}
      </div>
    </Marco>
  )
}
