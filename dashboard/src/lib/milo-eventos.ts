'use client'
import { useEffect, useRef } from 'react'

// Cuando una accion de Milo se CONFIRMA en el chat (components/MiloChat), los
// datos que tiene la pagina abierta ya no son los de la base. El chat avisa
// con este evento y las vistas que cargan datos por su cuenta (hooks con
// fetch, no componentes de servidor) recargan, para que el cambio se vea sin
// recargar la pagina a mano.
export const MILO_DATOS_CAMBIARON = 'milo:datos-cambiaron'

export function avisarDatosCambiaron() {
  window.dispatchEvent(new Event(MILO_DATOS_CAMBIARON))
}

export function useAlCambiarDatosMilo(recargar: () => void) {
  const ref = useRef(recargar)
  useEffect(() => { ref.current = recargar }, [recargar])
  useEffect(() => {
    const oyente = () => ref.current()
    window.addEventListener(MILO_DATOS_CAMBIARON, oyente)
    return () => window.removeEventListener(MILO_DATOS_CAMBIARON, oyente)
  }, [])
}
