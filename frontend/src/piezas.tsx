import type { ReactNode } from 'react'

/**
 * Las piezas compartidas. Aqui no hay ningun color escrito: todo sale de los tokens.
 *
 * Un `#2563EB` suelto en un componente sobrevive al cambio de tokens y rompe el
 * producto siguiente sin que nadie se entere hasta que lo mira.
 */

export function Estado({ tipo, children }: { tipo: 'bien' | 'aviso' | 'mal' | 'neutro'; children: ReactNode }) {
  return <span className={`estado ${tipo}`}>{children}</span>
}

export function Tarjeta({ titulo, children }: { titulo?: string; children: ReactNode }) {
  return (
    <div className="tarjeta">
      {titulo && <p className="etiqueta">{titulo}</p>}
      {children}
    </div>
  )
}

/**
 * Una tabla que nunca deja la pagina en blanco.
 *
 * Los tres estados -- cargando, error y vacio -- se resuelven aqui una vez. Dejarlo a
 * cada pantalla garantiza que en alguna se olvide el vacio, y el usuario vea una tabla
 * sin filas sin saber si esta cargando o si no hay nada.
 */
export function Tabla<T>({
  columnas,
  filas,
  fila,
  cargando,
  error,
  vacio,
}: {
  columnas: string[]
  filas: T[] | undefined
  fila: (f: T) => ReactNode
  cargando?: boolean
  error?: string | null
  vacio: string
}) {
  if (error) return <div className="error">{error}</div>
  if (cargando) return <div className="cargando">Loading…</div>
  if (!filas || filas.length === 0) return <div className="vacio">{vacio}</div>
  return (
    <div className="tabla-envoltorio">
      <table className="tabla">
        <thead>
          <tr>
            {columnas.map((c) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>{filas.map(fila)}</tbody>
      </table>
    </div>
  )
}

export function Marco({ nombre, nav, children }: { nombre: string; nav: ReactNode; children: ReactNode }) {
  return (
    <div className="marco">
      <aside className="lateral">
        <h2>{nombre}</h2>
        <nav className="nav" style={{ marginTop: 'var(--hueco)' }}>
          {nav}
        </nav>
      </aside>
      <main className="principal">{children}</main>
    </div>
  )
}
