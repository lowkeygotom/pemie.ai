# ROI de Pemie

**Decisión:** medimos valor con un número de bolsillo — *horas de seguimiento
recuperadas* — y un número que nos diferencia — *costo de vivir en dos
universos (humano vs agente)*. El primero convence al equipo esta semana. El
segundo evita que construyamos un Linear más flojo.

Esto no es el techo del producto (skills, MCPs como catálogo del equipo, etc.
siguen en la visión). Es la regla con la que sabemos si estamos mintiendo.

---

## La apuesta en una frase

> Cada semana pagamos horas para *saber* cómo vamos y para *traducir* lo que
> hicieron los agentes a un estado compartido. Pemie gana si ese impuesto baja
> de forma medible. Si no baja, no hay ROI — da igual cuántas HUs o tools MCP
> tengamos.

---

## Dos capas (no mezclarlas)

### 1. ROI primario — “¿nos ahorra tiempo?”

**Métrica:** horas de seguimiento / status por persona-semana, *antes vs con
Pemie*.

Incluye solo fricción de coordinación:

- syncs de avance (“dónde estamos”)
- buscar el estado de una HU / persona / agente
- actualizar tablero o tools a mano para que “quede alineado”
- reescribir un informe que ya debería existir a partir del trabajo real

**Fórmula:**

```
horas_ahorradas / semana = H_antes − H_con_Pemie
valor_aproximado       = horas_ahorradas × costo_hora_interno
```

`costo_hora_interno` puede ser rough. Lo importante es el Δ de horas, no el
tipo de cambio.

**Target de la 1ª medición (hipótesis, no dogma):** bajar ≥ 30 % esas horas.
Si tras medir sale 15 % o 60 %, actualizamos el target — no inventamos otro
métrica para salvaguardar el ego.

### 2. ROI diferenciador — “¿somos el Jira de esta era o un tablero más?”

Aquí es donde Pemie deja de competir con Linear en UX y empieza a competir en
**una sola fuente de verdad humano + agente**.

Dos señales juntas (ninguna sola basta):

| Señal | Pregunta que responde |
| --- | --- |
| Minutos/semana corrigiendo estado porque agente y realidad no coincidían | ¿Pagamos un impuesto de desalineación? |
| % de ciclos de agente (crear HU, mover tablero, publicar informe) cerrados sin que un humano “tape huecos” | ¿El agente opera el sistema o solo lo visita? |

Si la capa 1 mejora pero la 2 no, estamos haciendo project management mejor,
no el producto de nuestro objetivo.

---

## Ejemplo con números (equipo chico, inventado pero creíble)

Supón 3 personas, costo interno ~40 USD/hora.

| Concepto | Antes | Con Pemie | Δ |
| --- | ---: | ---: | ---: |
| Seguimiento / status (suma equipo / sem) | 9.0 h | 5.0 h | −4.0 h |
| Corregir desalineación humano↔agente | 3.0 h | 1.0 h | −2.0 h |
| **Total fricción** | **12 h** | **6 h** | **−6 h** |

Valor semanal aproximado: `6 × 40 = 240 USD`. En un mes: ~1k USD de tiempo
recuperado — **sin contar** el trabajo de producto que esos cerebros hacen
con esas horas.

Ese es el tipo de slide que mostramos: una tabla fea, un número, tres
evidencias del producto. No un deck de vision.

---

## Cómo lo medimos (protocolo corto)

### A. Encuesta diaria — 5 casillas, 30 segundos

Cada persona, al final del día (Notion, Slack poll, lo que sea; no construir
feature para esto todavía):

1. Minutos en syncs de avance  
2. Minutos buscando “¿en qué va X?”  
3. Minutos actualizando tablero/tools a mano  
4. Minutos corrigiendo estado agente ≠ realidad  
5. Minutos rehaciendo trabajo por estado viejo del agente  

Sumar → horas/semana/persona → promedio del equipo.

- **Semana 0–1:** baseline (Pemie puede existir, pero *no* es la fuente de
  verdad del equipo).  
- **Semana 2–3:** mismo ritual, pero operación real en web + MCP.

Si alguien no llena la encuesta, esa persona no entra al promedio. Mejor
muestra chica limpia que Excel fantasía.

### B. Señales de producto (máximo 3; el resto es ruido)

Elegir **tres** y mirarlas al cierre de la ventana “con Pemie”:

1. **Cobertura commit ↔ HU** — ¿las HUs en curso tienen commits que las
   referencian, o el tablero es teatro?  
2. **Informes** — ¿salieron del estado real (commits/HUs/tablero) o alguien
   los reescribió desde cero?  
3. **Agente operador** — contar ciclos MCP completos sin intervención
   manual vs ciclos que requirieron “human glue”.

PostHog y los informes de Pemie ayudan; no reemplazan la encuesta. La encuesta
captura el dolor humano. El producto aporta la evidencia de que no nos estamos
mintiendo.

---

## Anti-ROI (si alguien los trae a la reunión, empujar atrás)

- Commits, HUs creadas, tools MCP invocados → **actividad**. Útil para debug,
  inútil como valor.  
- “Ahora tenemos design system / clean architecture” → calidad de ingeniería,
  no ROI de producto.  
- “El objetivo dice que seremos el nuevo Jira” → visión. El ROI es si *esta*
  semana el impuesto bajó.  
- Catálogo de skills/MCPs → viene después; no se puede medir adopción interna
  con algo que aún no es el foco.

---

## Qué decimos en el sync del equipo

Una sola pregunta al abrir:

> ¿Bajó el impuesto de seguimiento y el de desalineación con agentes?
> Enséñame el Δ y tres evidencias. Si no, Pemie no está ganando todavía.

Si alguien quiere agregar una métrica, la prueba es: **¿cambia una decisión
de producto esta semana?** Si no, queda fuera.

---

## Checklist de la 1ª corrida

- [ ] Encuesta lista (5 casillas) y dueño del ritual nombrado  
- [ ] ≥ 5 días de baseline con ≥ 2 personas respondiendo  
- [ ] ≥ 5 días “con Pemie” (web + al menos un agente por MCP)  
- [ ] Tabla antes/después (horas + Δ)  
- [ ] Tres señales de producto documentadas  
- [ ] Target 30 % revisado con datos reales (mantener / subir / bajar)  
- [ ] Una decisión de producto tomada a partir del Δ (qué empujar, qué no)

## Cierre

El ROI oficial de Pemie, para ahora, es:

1. **Horas de seguimiento recuperadas**, y  
2. **Menos impuesto humano↔agente**.

Todo lo demás es color. Si no podemos enseñar (1) en un mes, no merecemos
hablar de (visión). Si enseñamos (1) pero (2) no se mueve, estamos construyendo
el producto equivocado con métricas correctas.
