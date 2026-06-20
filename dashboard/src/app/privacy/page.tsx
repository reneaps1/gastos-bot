import type { Metadata } from 'next'
import { Shield } from 'lucide-react'

export const metadata: Metadata = {
  title: 'Politica de Privacidad - Milo Gastos',
  description: 'Politica de privacidad de Milo Gastos',
}

export default function PrivacyPage() {
  return (
    <div className="max-w-3xl mx-auto py-8 space-y-8">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-indigo-100 dark:bg-indigo-900/50 flex items-center justify-center">
          <Shield className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Politica de Privacidad</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Ultima actualizacion: 20 de junio de 2026</p>
        </div>
      </div>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold mb-2">1. Datos que recopilamos</h2>
          <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
            Milo Gastos recopila los siguientes datos personales y financieros proporcionados voluntariamente por el usuario:
          </p>
          <ul className="list-disc pl-5 mt-2 text-sm text-slate-600 dark:text-slate-300 space-y-1">
            <li>Nombre de usuario y numero de telefono (para identificacion en WhatsApp)</li>
            <li>Transacciones financieras (montos, descripciones, categorias, fechas)</li>
            <li>Presupuestos y metas financieras</li>
            <li>Informacion de deudas y creditos</li>
            <li>Snapshots de liquidez (saldos de cuentas bancarias)</li>
          </ul>
        </div>

        <div>
          <h2 className="text-lg font-semibold mb-2">2. Como usamos los datos</h2>
          <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
            Los datos se utilizan exclusivamente para:
          </p>
          <ul className="list-disc pl-5 mt-2 text-sm text-slate-600 dark:text-slate-300 space-y-1">
            <li>Mostrar el dashboard financiero personal del usuario</li>
            <li>Generar reportes y graficas de gastos e ingresos</li>
            <li>Enviar alertas y resumenes financieros via WhatsApp</li>
            <li>Permitir la administracion de presupuestos, deudas y metas</li>
          </ul>
        </div>

        <div>
          <h2 className="text-lg font-semibold mb-2">3. Almacenamiento y seguridad</h2>
          <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
            Los datos se almacenan en una base de datos PostgreSQL alojada en Render (proveedor de infraestructura en la nube con certificacion SOC 2). Las medidas de seguridad incluyen:
          </p>
          <ul className="list-disc pl-5 mt-2 text-sm text-slate-600 dark:text-slate-300 space-y-1">
            <li>Acceso restringido a la base de datos por IP y credenciales</li>
            <li>Conexiones cifradas via TLS/SSL</li>
            <li>Las credenciales de acceso no se comparten con terceros</li>
            <li>El codigo fuente es privado y no se distribuye</li>
          </ul>
        </div>

        <div>
          <h2 className="text-lg font-semibold mb-2">4. Comparticion de datos con terceros</h2>
          <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
            Milo Gastos <strong>no comparte</strong> datos personales o financieros con terceros. No se utilizan servicios de analitica, publicidad ni redes sociales que recopilen datos del usuario.
          </p>
          <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed mt-2">
            Los unicos servicios de infraestructura utilizados son:
          </p>
          <ul className="list-disc pl-5 mt-2 text-sm text-slate-600 dark:text-slate-300 space-y-1">
            <li>Render (alojamiento de base de datos y servidor web)</li>
            <li>Meta/WhatsApp Cloud API (solo para enviar y recibir mensajes del bot)</li>
          </ul>
        </div>

        <div>
          <h2 className="text-lg font-semibold mb-2">5. Derechos del usuario</h2>
          <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
            El usuario tiene derecho a:
          </p>
          <ul className="list-disc pl-5 mt-2 text-sm text-slate-600 dark:text-slate-300 space-y-1">
            <li><strong>Acceso:</strong> Solicitar una copia de todos los datos almacenados</li>
            <li><strong>Correccion:</strong> Modificar datos incorrectos a traves del dashboard</li>
            <li><strong>Eliminacion:</strong> Solicitar la eliminacion completa de sus datos</li>
            <li><strong>Portabilidad:</strong> Solicitar la exportacion de sus datos en formato CSV</li>
          </ul>
          <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed mt-2">
            Para ejercer estos derechos, contactar al correo electronico proporcionado en la seccion 7.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold mb-2">6. Retencion de datos</h2>
          <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
            Los datos se conservan mientras el usuario mantenga una cuenta activa. Si el usuario solicita la eliminacion de su cuenta, todos los datos asociados se eliminaran en un plazo de 30 dias.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold mb-2">7. Contacto</h2>
          <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
            Para cualquier pregunta sobre esta politica de privacidad o para ejercer sus derechos, contactar a:
          </p>
          <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed mt-2">
            <strong>Correo:</strong> rene@ejemplo.com<br />
            <strong>App:</strong> https://gastos-dashboard.onrender.com
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold mb-2">8. Cambios a esta politica</h2>
          <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
            Esta politica puede actualizarse periodicamente. Los cambios significativos se notificaran a traves de la aplicacion. El uso continuo de la app despues de los cambios constituye la aceptacion de la politica actualizada.
          </p>
        </div>
      </section>
    </div>
  )
}
