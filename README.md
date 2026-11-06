# Bot de Telegram para facturas C en ARCA

Node.js + TypeScript, `@arcasdk/core` (la biblioteca de afipts.com), `@arcasdk/pdf`, grammY y PostgreSQL. Emite Facturas C y Notas de Crédito C totales de monotributo en pesos, con una descripción y un importe total por comprobante. Permite productos, servicios y ambos; pide el período y vencimiento cuando corresponde. Incluye `/factura_fija` para un receptor y servicio habituales configurados en `.env`.

## Puesta en marcha

Requisitos: Node.js 22.13 o posterior, PostgreSQL 14 o posterior y un certificado ARCA con su clave privada para WSFE.

1. Crear un bot con [@BotFather](https://t.me/BotFather) y obtener el token.
2. Copiar `.env.example` a `.env` y completar los valores. No enviar tokens, contraseña de PostgreSQL ni clave privada por Telegram.
3. Crear una base dedicada en PostgreSQL o indicar una existente en `DATABASE_URL`. El usuario necesita permisos para crear tablas e índices y leer/escribir sus datos. La aplicación crea `arca_bot_invoices` (operaciones y PDF) y `arca_bot_issuer` (perfil del emisor), junto con sus índices.
4. Guardar certificado y clave en `certs/` y configurar sus rutas. El CUIT del emisor, su punto de venta y los datos fiscales deben corresponder al certificado y ambiente elegidos.
5. Instalar y ejecutar:

```powershell
npm install
npx puppeteer browsers install chrome
npm run build
npm start
```

Para desarrollo: `npm run dev`. Para pruebas: `npm test`.

Dejar la terminal abierta mientras se usa el bot. Para detenerlo, presionar **Ctrl+C**. Después de cambiar `.env`, reiniciar: `npm run dev` para desarrollo o `npm run build` y `npm start` para ejecutar el código compilado tras una actualización.

`DATABASE_URL` usa el formato `postgresql://usuario:contraseña@host:5432/base`. Los caracteres especiales de usuario/contraseña deben codificarse como componentes de URL. Para un servidor que requiere TLS, configurar `DATABASE_SSL=true` con una cadena de certificados confiable; no se desactiva la validación del certificado.

`TELEGRAM_ALLOWED_USER_IDS` acepta IDs numéricos separados por comas. Para obtener tu ID, ejecutar `/miid` en el bot. Inicialmente puede utilizarse un ID provisional y luego reiniciar con el correcto. El bot solamente permite operaciones fiscales en chats privados de usuarios autorizados.

## Uso

- `/factura`: iniciar o continuar un borrador. Ingresar CUIT o DNI, documento, nombre, domicilio, condición IVA, descripción, total, forma de pago y concepto. Las condiciones IVA se consultan en ARCA para comprobantes C. En el flujo con DNI se admite Consumidor Final.
- `/emisor`: consultar tus datos fiscales y completar únicamente los faltantes. Si falta algún dato al iniciar `/factura`, el bot lo pide antes de crear el borrador; después continúa con el receptor.
- Confirmar el resumen con **Confirmar y emitir**. La factura se solicita a ARCA solamente al pulsar ese botón.
- Antes de emitir, se consulta `electronicBillingService.getServerStatus()`. Aplicación, base de datos y autenticación deben informar `OK`; si falla la consulta o algún componente, el borrador se conserva sin enviar y puede confirmarse otra vez más tarde. Este chequeo no reemplaza el manejo de interrupciones durante la solicitud de CAE.
- Después de emitir, el bot muestra número, CAE y vencimiento, adjunta la respuesta completa del SDK como JSON y entrega el PDF con QR y las copias ORIGINAL, DUPLICADO y TRIPLICADO.
- El PDF se envía con el formato de nombre de ARCA: `CUIT_TIPO_PUNTOVENTA_NUMERO.pdf`, con tipo de comprobante de 3 dígitos (`011` para Factura C y `013` para Nota de Crédito C), punto de venta de 5 y número de 8. Ejemplo: `20123456786_011_00002_00000001.pdf`. Se usa el mismo nombre al descargarlo con `/pdf ID`.
- `/cancelar`: descartar solamente un borrador.
- `/historial`: ver las últimas diez operaciones propias y sus IDs.
- `/pdf ID`: recuperar el PDF de una factura o nota de crédito autorizada sin reemitirla.
- `/respuesta ID`: obtener nuevamente el JSON devuelto por ARCA.
- `/recuperar ID`: consultar un comprobante cuya autorización quedó incierta tras una interrupción.
- `/estado`: consultar el estado del servicio ARCA.
- `/factura_fija`: receptor con CUIT, domicilio, condición IVA y descripción del servicio desde `RECEPTOR_CUIT`, `RECEPTOR_RAZON_SOCIAL`, `RECEPTOR_DOMICILIO`, `RECEPTOR_IVA_ID` y `FACTURA_FIJA_DESCRIPCION` en `.env`. `FACTURA_FIJA_FORMA_PAGO` define la forma de pago (Contado por defecto). Pide solo importe total, inicio y fin del servicio y vencimiento de pago, y luego confirmación. La fecha de emisión es el día de creación del borrador. Valida CUIT y condición IVA contra el catálogo WSFE para Factura C. Guarda una copia de los valores configurados en el borrador: cambios posteriores del `.env` no alteran el borrador ni comprobantes anteriores. Reiniciar tras configurar; `/factura` mantiene el ingreso manual.
- `/nota_credito ID`: crear una Nota de Crédito C TOTAL para una Factura C autorizada del propio historial, en el ambiente y punto configurados. Pide motivo y confirmación; conserva receptor e importe y asocia el comprobante original. Tiene numeración independiente (tipo 13), PDF y recuperación. Evita otra nota total activa para la misma factura dentro del bot, incluso tras reiniciar. No detecta notas emitidas fuera del bot: verificarlas antes de confirmar. No admite importes parciales ni facturas externas. En producción emite un comprobante real; para probar usar homologación con sus certificados y una factura de ese ambiente.
- `/verificar_produccion`: comprobar servidores, autenticación y acceso a WSFE, punto de venta activo para CAE y último número de Factura C, sin emitir. Requiere el bot configurado en producción; en homologación no consulta producción. No valida los datos de una futura factura ni reserva numeración.
- `/miid`: consultar tu ID numérico de Telegram, incluso antes de estar autorizado. No es el teléfono ni el nombre de usuario.

`ID` es el UUID de la operación mostrado en `/historial`, no su número de comprobante. Los comandos `/pdf`, `/respuesta`, `/recuperar` y `/nota_credito` usan ese UUID.

En producción se activa `useHttpsAgent` del SDK para compatibilidad con los servidores TLS de ARCA que pueden devolver `EPROTO: dh key too small`. El agente mantiene la validación de certificados; no se desactiva TLS globalmente.

El monto se escribe sin separador de miles: `15000,50` o `15000.50`. Las fechas de servicio y vencimiento usan `AAAA-MM-DD`. El comprobante tiene la fecha del día argentino; un borrador de un día anterior debe recrearse.

## Factura fija

Completar en `.env` los datos del receptor habitual y la descripción. Este ejemplo usa valores ficticios que deben reemplazarse por los correspondientes:

```env
RECEPTOR_CUIT=20123456786
RECEPTOR_RAZON_SOCIAL="EMPRESA DE EJEMPLO SAS"
RECEPTOR_DOMICILIO="Domicilio de la empresa"
RECEPTOR_IVA_ID=1
FACTURA_FIJA_DESCRIPCION="Servicios de consultores en informática y suministros de programas de informática."
FACTURA_FIJA_FORMA_PAGO=Contado
```

Las comillas son opcionales para valores con espacios; si un valor contiene `#`, usar comillas para evitar que se interprete como comentario. `RECEPTOR_IVA_ID=1` corresponde a IVA Responsable Inscripto. La forma jurídica del receptor (por ejemplo, SAS) no determina su condición IVA: configurar la que corresponda. El código se valida contra el catálogo de ARCA.

Después de reiniciar, enviar `/factura_fija`. Pregunta, en orden: importe total, inicio del servicio, fin del servicio y vencimiento de pago. El concepto es Servicios y la fecha de emisión es la del día de creación. Usa el mismo resumen y botón de confirmación que `/factura`. Si ya existe un borrador fijo, lo continúa; si hay otro borrador, exige completarlo o cancelarlo antes.

La forma de pago puede ser Contado, Efectivo, Transferencia bancaria, Tarjeta de débito, Tarjeta de crédito, Cuenta corriente, Cheque u Otro. Se guarda y aparece como condición de venta en el PDF; no se envía como medio de pago a WSFE. El vencimiento de pago sí se envía para servicios. La condición de IVA del receptor se envía mediante `CondicionIVAReceptorId`; Factura C y Nota de Crédito C mantienen `ImpIVA=0`.

## Notas de crédito

Para crear una nota total, obtener el ID de una Factura C autorizada en `/historial` y enviar:

```text
/nota_credito UUID_DE_LA_FACTURA
```

Ingresar el motivo, revisar receptor, importe y factura asociada y confirmar. La nota se emite como tipo `13`, con `CbtesAsoc` indicando tipo `11`, punto, número, CUIT emisor y fecha de la factura original. Reutiliza el receptor e importe total, conserva el período del servicio y actualiza fecha de emisión y vencimiento de pago al día. Tiene su propia numeración; una primera nota puede ser número 1 aunque la factura asociada sea número 55.

El registro original sigue autorizado: la nota es otro comprobante asociado, no un borrado. `/cancelar` solamente descarta borradores. Las notas totales activas o autorizadas bloquean una segunda nota total para la misma factura dentro del bot. Las canceladas o rechazadas permiten crear otra. Si la emisión queda incierta, usar `/recuperar ID` antes de volver a emitir.

Para probar, configurar homologación y usar una factura de ese mismo ambiente y punto. No usar una factura de producción como origen de una nota de prueba. Antes de confirmar una nota real, comprobar que no existan notas emitidas por otros sistemas: el bot no las contabiliza.

## Persistencia y emisión

PostgreSQL guarda el borrador, payload enviado, estado, respuesta del SDK/ARCA, CAE, vencimiento y PDF (`BYTEA`). Los datos se separan por ambiente, CUIT y punto de venta. Los tickets WSAA se guardan localmente en `DATA_DIR` y también son sensibles.

La solicitud del comprobante se conserva en `arca_bot_invoices.body -> 'payload'` antes de emitir; la respuesta en `body -> 'arcaResponse'`. No se guarda el XML SOAP completo ni sus credenciales de autenticación. Para inspeccionarlas desde pgAdmin:

```sql
SELECT id, context, status, created_at,
       jsonb_pretty(body -> 'payload') AS request,
       jsonb_pretty(body -> 'arcaResponse') AS respuesta,
       pdf IS NOT NULL AS tiene_pdf
FROM arca_bot_invoices
ORDER BY created_at DESC;
```

Los estados son `draft`, `issuing`, `uncertain`, `authorized`, `rejected` y `cancelled`. Un registro cancelado corresponde a un borrador local; no significa que se haya anulado un comprobante autorizado en ARCA.

Certificados y clave se colocan en la carpeta `certs/`, creada manualmente. Los tickets se generan automáticamente en `data/AMBIENTE/CUIT/PUNTO/tickets/` con la configuración predeterminada. No confundir el archivo CSR de solicitud con el certificado firmado que entrega ARCA.

Al iniciar, el bot consulta `registerScopeFiveService.getTaxpayerDetails` de `@arcasdk/core` para tu CUIT. Para ello también debe autorizarse el servicio `ws_sr_padron_a5` en el ambiente correspondiente. Se obtiene razón social o apellido/nombre y domicilio fiscal, que se usa como domicilio comercial por defecto. Si tu domicilio comercial es distinto, configurar `EMISOR_DOMICILIO` explícitamente.

Los cuatro valores `EMISOR_*` en `.env` son opcionales y tienen prioridad sobre el padrón y los datos guardados. El padrón A5 no expone número de Ingresos Brutos ni la fecha exacta de inicio que lleva el comprobante; los períodos de alta de impuestos y actividades no se usan para inventarlos. El bot pide esos faltantes por Telegram una sola vez y los guarda en `arca_bot_issuer`, por ambiente, CUIT y punto de venta. Si falla el padrón o devuelve otro CUIT, usa valores configurados/guardados y pide solamente lo que falta. No muestra tokens ni mensajes SOAP en esos avisos.

Actualmente `/emisor` incluye un diagnóstico temporal con la respuesta devuelta por el SDK, incluso `null`; se recorta si excede el límite de Telegram y oculta campos de credenciales. Muestra la consulta realizada al arrancar, no hace una nueva consulta por cada comando. Este diagnóstico está pendiente de retirar cuando termine la revisión del padrón. El bot todavía no consulta el padrón del receptor: usa los datos ingresados manualmente o configurados en `.env`.

Los errores de inicio y de operaciones se informan en consola con mensaje, traza, código y causa, con filtros para credenciales. `/verificar_produccion` también muestra los errores de ARCA con código y mensaje, y los valores del punto de venta cuando no pasa la validación.

Los usuarios autorizados comparten el perfil del emisor. Antes de emitir se exige que esté completo y se guarda una copia de sus datos dentro del registro de la factura, para que un cambio posterior de domicilio o nombre no altere la regeneración de su PDF. La consulta real del padrón requiere tus credenciales y autorización; las pruebas locales usan respuestas simuladas.

Un bloqueo de sesión PostgreSQL impide iniciar dos bots para el mismo contexto; se requiere conexión directa o un pool en modo sesión, no un pool en modo transacción. Cada emisión se registra de forma durable antes de enviar la solicitud. Una emisión incierta bloquea nuevas emisiones de ese contexto. Al reiniciar, los intentos que estaban emitiendo pasan a inciertos.

La recuperación consulta el mismo número y verifica documento, fecha, concepto, moneda e importes. Nunca emite automáticamente otro comprobante. Si ARCA no confirma datos coincidentes, el bloqueo se mantiene para revisión manual: no eliminar registros ni resetear su estado sin reconciliar primero el número en ARCA. El bloqueo coordina este bot; otros sistemas que usen el mismo punto de venta requieren coordinación externa. Utilizar un punto de venta dedicado.

La factura autorizada queda guardada aunque falle la generación o el envío del PDF. Se puede reintentar su descarga con `/pdf ID`. Si la primera respuesta se pierde por un corte, `/recuperar` guarda la respuesta de consulta; no puede reconstruir la respuesta original que nunca llegó.

## PDF y referencia de la web de ARCA

Se genera con `@arcasdk/pdf` y una plantilla propia (`src/arca-template.ts`) ajustada contra la factura C de Comprobantes en Línea proporcionada por el usuario. Reproduce el encabezado, letra y código, período facturado, bloque del receptor, ocho columnas del detalle, recuadro de totales y bloque de autorización con QR, logo, número de página y CAE. Los importes se muestran sin separador de miles, como en la referencia.

El web service WSFE autoriza el comprobante; el PDF se renderiza localmente. Se conserva el generador, QR y armado de copias de `@arcasdk/pdf`. `pdf-lib` oculta la franja de pie genérica que el SDK agrega automáticamente, porque la referencia ubica la paginación junto al CAE. El logo público de ARCA fue extraído de la referencia; sus datos personales y su QR no se incorporaron a la plantilla.

Se verificó visualmente el formato con una muestra ficticia. No se afirma identidad binaria ni una comparación píxel por píxel: el motor PDF y los datos del ejemplo son distintos. La muestra de homologación agrega una leyenda sin validez fiscal. Los PDF previamente guardados en PostgreSQL se conservan; la nueva plantilla se utiliza al generar PDF que aún no estaban almacenados.

Se puede generar una muestra ficticia sin acceder a ARCA, Telegram ni PostgreSQL:

```powershell
npx tsx scripts/sample-pdf.ts
npx tsx scripts/sample-credit-pdf.ts
```

Las muestras se guardan en `output/pdf/factura-c-prueba.pdf` y `output/pdf/nota-credito-c-prueba.pdf`, marcadas sin validez fiscal. La nota muestra título NOTA DE CRÉDITO, código 013 y factura asociada. En homologación, todos los PDF del bot llevan esa leyenda; en producción no se agrega.

## Homologación y producción

El valor inicial es `ARCA_ENV=homologacion`. Para producción configurar `ARCA_ENV=produccion`, certificado/clave del ambiente correcto y un punto de venta habilitado para Web Services de monotributo. No se realiza ninguna emisión de prueba automática al iniciar.

Ejemplo de las variables para producción (usar las rutas y el punto realmente habilitados):

```env
ARCA_ENV=produccion
ARCA_CERT_PATH=certs/produccion.crt
ARCA_KEY_PATH=certs/produccion.key
ARCA_PUNTO_VENTA=2
```

Los certificados de homologación se gestionan desde WSASS; los de producción desde Administración de Certificados Digitales y Administrador de Relaciones de Clave Fiscal. Autorizar WSFE para emitir y `ws_sr_padron_a5` para consultar el emisor en cada ambiente. Los certificados de prueba no sirven en producción.

Si se facturaba desde Comprobantes en Línea, crear un punto distinto para **Factura Electrónica - Monotributo - Web Services** desde **Administración de puntos de venta y domicilios**, en **A/B/M de puntos de venta**, opción **Agregar**. Seleccionar número disponible, domicilio y actividad correspondientes y confirmar. Configurar su número en `.env`; cambiar la variable no da de alta el punto en ARCA.

Reiniciar y ejecutar `/verificar_produccion` antes de la primera emisión real. Comprueba servidores, una consulta autenticada de puntos y el último número de Factura C del punto configurado. Reconoce `CAE - Monotributo`, `bloqueado=N` y fecha de baja vacía, `NULL` o `00000000` como punto activo. Un resultado `602` sin puntos exige revisar su alta y el ambiente/CUIT consultado; `11002` indica que el punto no está habilitado para el WS. El próximo número informado es una consulta, no una reserva.

La numeración de ARCA se consulta antes de emitir y es independiente por ambiente, punto y tipo. Limpiar la base local no la reinicia. Homologación no tiene validez fiscal; producción autoriza comprobantes reales. Las consultas de verificación no consumen números ni sustituyen la validación de los datos del comprobante al emitir.

Guías de certificados, autorización del servicio y facturación: https://www.afipts.com/introduction.html y https://www.afipts.com/services/facturacion_electronica.

## Validación y limitaciones

Las pruebas cubren validación de importes/documentos/fechas, factura manual y fija, notas de crédito totales y asociaciones, numeración por tipo, doble confirmación, permisos de Telegram, fallos de persistencia, rechazo, recuperación tras interrupciones, verificación de producción y filtros de errores. No sustituyen una emisión de homologación con tus credenciales.

La prueba de integración PostgreSQL se habilita con `TEST_DATABASE_URL` apuntando a una base de pruebas; crea sus registros bajo un contexto aleatorio y los elimina al terminar. Verifica persistencia, aislamiento por usuario, bloqueo de una segunda instancia, recuperación al reiniciar y almacenamiento del PDF. Sin esa variable se omite esa prueba. Se verificó con una instancia aislada de PostgreSQL 18. Las pruebas de Telegram usan transporte simulado, sin enviar mensajes reales.

El bot no implementa notas de crédito parciales, facturas externas como origen de notas, múltiples ítems, tributos adicionales, divisas, facturas A/B ni exportación. Los datos del receptor se cargan manualmente o desde `.env`; no se presume su condición fiscal desde su documento. Los registros y PDF contienen datos personales: restringir acceso a la base y sus copias de respaldo.
