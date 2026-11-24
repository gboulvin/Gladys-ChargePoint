# ChargePoint

Controle sus cargadores domésticos ChargePoint (ChargePoint Home, Home Flex)
desde Gladys, siga sus sesiones de carga — en casa y en la red pública — y
vigile la disponibilidad de las estaciones públicas que utiliza.

La integración se comunica con la nube de ChargePoint, la misma que usa la
aplicación móvil ChargePoint (es una adaptación a JavaScript de la biblioteca
[python-chargepoint](https://github.com/mbillow/python-chargepoint) que usa la
integración de Home Assistant
[ha-chargepoint](https://github.com/mbillow/ha-chargepoint)). Es una
integración **en la nube**: Gladys necesita acceso a Internet y los
cargadores deben estar en línea.

> Esta integración no está afiliada a ChargePoint, Inc.

## Configuración

1. Abra la pestaña **Configuración** de la integración.
2. Introduzca el **correo** (o usuario) y la **contraseña** de su cuenta
   ChargePoint y guarde.
3. El estado en la parte superior de la página se pone en verde una vez
   conectado. El botón **Probar la conexión** indica cuántos cargadores
   domésticos y estaciones públicas se encontraron.
4. Abra la pestaña **Descubrimiento** y añada los dispositivos que desee.

Después, la integración mantiene la sesión por sí sola: ChargePoint la
renueva en cada petición, y la más reciente se guarda en el volumen privado
`/data` de la integración, de modo que un reinicio no vuelve a iniciar
sesión.

### Cuando ChargePoint pide un captcha

ChargePoint protege su página de inicio de sesión con una detección de bots
(Datadome). Cuando bloquea el inicio de sesión con contraseña, el estado
indica _ChargePoint pide un captcha_. Use entonces la sesión de su navegador:

1. Inicie sesión en [chargepoint.com](https://www.chargepoint.com) en un
   navegador de ordenador.
2. Abra las herramientas de desarrollo (F12) → **Aplicación** (Chrome, Edge)
   o **Almacenamiento** (Firefox) → **Cookies** →
   `https://www.chargepoint.com`.
3. Copie el valor de la cookie `coulomb_sess`.
4. Péguelo en el campo **Token de sesión (coulomb_sess)** de la configuración
   y guarde.

El token es un secreto: Gladys no lo vuelve a mostrar y la integración nunca
lo escribe en sus registros.

### Opciones

- **Intervalo de actualización** — frecuencia de lectura de ChargePoint, en
  segundos: 3 minutos por defecto, 1 minuto como mínimo. Un comando provoca
  una lectura adicional unos segundos después.
- **Estaciones públicas a seguir** — los identificadores de estaciones
  públicas ChargePoint, separados por comas. Para encontrarlos, use el botón
  **Buscar estaciones cercanas** con la latitud y la longitud de un lugar:
  enumera los identificadores de las estaciones de alrededor.

## Dispositivos

### Cargador doméstico

Un dispositivo por cargador doméstico ChargePoint de la cuenta, con el nombre
que tiene en la aplicación ChargePoint.

| Función                | Qué hace                                                          |
| ---------------------- | ----------------------------------------------------------------- |
| Charging               | Inicia (1) o detiene (0) una sesión de carga                      |
| Vehicle plugged in     | Si el cable está conectado a un vehículo                          |
| Connector status       | Disponible, ocupado, no disponible (sin conexión) o averiado      |
| Charging state         | Cargando, vehículo conectado, en pausa (vehículo o cargador)…     |
| Charging power         | Potencia entregada por la sesión en curso (W)                     |
| Session energy         | Energía de la sesión en curso o de la última (kWh)                |
| Session cost           | Coste de la sesión en curso o de la última                        |
| Session duration       | Duración de la sesión en curso o de la última (minutos)           |
| Charging current limit | Corriente de carga máxima (A), entre los valores del cargador     |
| Charging schedule      | Activa o desactiva la programación de la aplicación ChargePoint   |
| LED brightness         | Brillo de los LED del cargador (0 % = apagados, en pasos de 20 %) |

Iniciar una sesión requiere un vehículo conectado. ChargePoint confirma los
inicios y paradas en aproximadamente un minuto; el estado se actualiza en la
siguiente lectura.

### Cuenta ChargePoint

El saldo de la cuenta y la sesión en curso, esté donde esté, estaciones
públicas incluidas (carga, potencia, energía, coste).

### Estación pública

Un dispositivo por estación seguida: su disponibilidad (disponible en cuanto
un punto de carga está libre) y el número de puntos libres.

Cada dispositivo muestra una insignia **nube**, que pasa a _inaccesible_
cuando ChargePoint o el cargador no responde.

## Acciones (pantalla Configuración)

- **Probar la conexión** — se conecta, lo lee todo e indica la cuenta y lo
  encontrado.
- **Reiniciar un cargador doméstico** — reinicia a distancia el cargador
  elegido (queda sin conexión unos minutos).
- **Buscar estaciones cercanas** — enumera los identificadores de las
  estaciones públicas alrededor de una latitud / longitud (radio de 100 m a
  5 km).

## Escenas

La integración añade sus propias tarjetas al editor de escenas (Gladys 5.1 o
posterior), en la categoría **Integraciones**.

Disparadores (deje el dispositivo vacío para aceptar cualquiera):

- **Carga iniciada** — un cargador doméstico, o la cuenta (estación pública),
  empieza a cargar.
- **Carga terminada** — una sesión termina. Las acciones siguientes pueden
  leer `{{triggerEvent.data.energy_kwh}}`, `{{triggerEvent.data.cost}}` y
  `{{triggerEvent.data.duration_minutes}}`.
- **Vehículo conectado** / **Vehículo desconectado** — el cable de un
  cargador doméstico.
- **Estación pública disponible** — una estación seguida no tenía puntos
  libres y ahora tiene uno (`{{triggerEvent.data.available_ports}}`).

Acciones:

- **Iniciar la carga** — devuelve `started`: falso si no hay ningún vehículo
  conectado, para que las acciones siguientes puedan reaccionar.
- **Detener la carga** — en un cargador, o cualquier sesión en curso si no se
  elige dispositivo; devuelve `stopped`.
- **Ajustar el límite de corriente** — devuelve la corriente realmente
  aplicada (el valor aceptado más cercano, nunca por encima del pedido).
- **Ajustar la programación** — la activa (opcionalmente con nuevos horarios
  entre semana / fin de semana, `HH:MM`) o la desactiva.
- **Reiniciar un cargador**.

Ejemplo: _cuando la electricidad es barata (disparador de horas valle),
iniciar la carga; cuando la carga termina, enviarme la energía y el coste_.

## Panel

- **Cargador ChargePoint** — elija un cargador doméstico en los ajustes del
  widget: potencia, energía y límite de corriente en directo, su estado,
  cable, red, programación, duración y coste de la sesión, y un botón
  **Iniciar carga** / **Detener carga**.
- **Cuenta ChargePoint** — saldo, potencia en directo, sesión en curso,
  puntos libres de las estaciones seguidas y un botón **Detener carga**
  durante una sesión.

## Solución de problemas

- **Estado «ChargePoint rechazó el correo o la contraseña»** — compruébelos
  en la aplicación ChargePoint; el correo es el de la cuenta.
- **Estado «ChargePoint pide un captcha»** — vea
  [más arriba](#cuando-chargepoint-pide-un-captcha).
- **Estado «La sesión de ChargePoint caducó»** — introduzca su contraseña (la
  integración renueva después la sesión por sí sola) o un nuevo token de
  sesión.
- **Un cargador aparece _inaccesible_** — el cargador perdió su conexión
  Wi-Fi con ChargePoint; compruébelo en la aplicación ChargePoint.

Configure `LOG_LEVEL=debug` para ver el detalle de cada petición en los
registros de la integración (interfaz de Gladys o `docker logs`). Los tokens
y las contraseñas nunca se registran.
