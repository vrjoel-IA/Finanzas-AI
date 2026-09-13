# Plan: Presupuestos sin carteles, pestaña Ahorros, Dashboard unificado, Informe Aura y Aura Vision directo

> **Estado (13/09/2026): las 7 fases están implementadas, sin commit.** `npm test` (165), `npm run lint` y `npm run build` en verde.
> Se probó en navegador con datos de prueba en Modo Local: editar y borrar heredados sin tocar el mes de origen, deshacer,
> pestaña Ahorros, navegación desde el widget principal, Aura Vision abriendo el selector sin cambiar de pantalla, y
> historial de transacciones y cuentas idénticos al final.
>
> Cambios respecto al plan: el desglose Ingresos/Gastos/Ahorro del widget principal sale abierto por defecto (llena la
> tarjeta y deja los accesos a la vista); el tono de tarjeta está en `components/budgetTone.ts`.
>
> Pendiente, solo manual: comentario de Aura con sesión real (Modo Local no tiene sesión para llamar a Gemini) y Aura
> Vision con cámara en un móvil real. Las fotos muy grandes pueden superar `MAX_IMAGE_CHARS` en el servidor; ahora el
> error se muestra en pantalla en lugar de perderse en la consola.

## Contexto

Feedback de uso real sobre FINANZAS AI PRO (React 19 + Vite + Recharts, estado único en `App.tsx` que se sube entero a Supabase):

- La herencia de presupuestos (mismo mes del año anterior / mes anterior) funciona bien, pero la UI obliga a pulsar "Personalizar" y llena la pantalla de avisos "Heredado de…". El usuario quiere editar, borrar o añadir directamente.
- "Retos AI Aura" no aporta. Se sustituye por un **Informe de Aura**: cómo va el mes y categorías a vigilar; al cerrarse el mes, pasa a ser un resumen de ese mes.
- El Dashboard tiene widgets redundantes (dos gráficos de evolución, "En qué se va" separado de presupuestos) y la comparativa solo mira el periodo anterior. Además el dato "Ahorro" de la comparativa y de la gráfica mes a mes está mal: usa `netResult` en lugar del dinero movido a huchas que muestra el widget principal.
- Aura Vision desde el botón flotante navega a Transacciones y no abre nada (`triggerScan` no lo lee nadie). Debe abrir directamente cámara/galería.
- En Presupuestos, los totales ocupan demasiado y el aviso de exceso se pinta en rojo en la barra y la cifra; se quiere la tarjeta entera roja (gasto pasado) o verde (ingreso u objetivo de ahorro alcanzado), manteniendo el color propio de la categoría.
- Nueva pestaña **Ahorros** en Presupuestos con objetivo de aportación mensual por hucha, sincronizada con la pantalla Huchas en ambos sentidos.
- El widget principal debe ser navegable: Ingresos / Gastos / Ahorro llevan a la pestaña correspondiente de Presupuestos.

Decisiones ya tomadas con el usuario:
1. Objetivo de Ahorros = **aportación mensual por hucha**, con la misma herencia que gastos e ingresos.
2. Tarjeta de ingresos en verde **al alcanzar el objetivo**. Tarjeta de ahorro en **ámbar** (el color de ahorro de la app, `amber` / `#f59e0b`) al alcanzar el objetivo, nunca en verde.
3. Informe Aura = **cálculo local siempre + comentario de IA a petición** (se guarda por mes solo al pulsar el botón).

## Reglas transversales (obligatorias)

- **Ningún cambio crea o modifica transacciones ni altera cuentas como efecto secundario.** Las transacciones solo se crean al confirmar el modal, exactamente como hoy.
- **Nada escribe estado al montar o navegar.** Toda escritura nace de un clic del usuario (el guardado sube el documento entero; ver comentarios en `services/dashboardBlocks.ts` y `services/budgetPlan.ts`).
- La lógica de cálculo nueva va en `services/*.ts` puros (sin React), cargables por `tests/_load.mjs`, con tests en `tests/*.test.mjs`.
- Campos nuevos de `FinanceState` son **opcionales** (el estado se carga como `{ ...INITIAL_DATA, ...guardado }`) y se añaden a la copia descargable en `App.tsx` (objeto `plano`, ~L1065 y ~L1221).
- No borrar datos existentes: `challenges` se queda en el estado y en `advisorContext.ts`; solo desaparece el widget.
- Pruebas manuales con una cuenta de prueba o Modo Local **en un perfil de navegador distinto**, nunca con la sesión real abierta (origen del incidente del 13/09/2026).

Commits sugeridos: uno por fase, `npm test && npm run lint && npm run build` en verde antes de cada uno.

---

## Fase 1 — Herencia de presupuestos sin carteles

**Problema técnico.** Una tarjeta heredada es el `Budget` de otro mes (`sourceId`, `period` del origen). Editarla con `updateBudget` modificaría el mes origen. Y como `resolveEffectiveBudgets` rellena con heredados las categorías que falten (test "un solo presupuesto propio ya no bloquea la herencia del resto"), borrar una propia la haría reaparecer desde el origen. Además, crear un solo presupuesto propio en un mes heredado convierte ese mes en fuente parcial para los meses siguientes.

**Solución.**

1. `services/budgetPlan.ts`
   - `resolveEffectiveBudgets(budgets, target, index, exclusions?: Record<string, string[]>)`: las claves `budgetKey` presentes en `exclusions[target]` se marcan como `taken` antes de heredados y legacy, sin emitirse. `annualizeYear` pasa el mapa a cada mes.
   - Nuevo `prepareMonthForEdit(budgets, target, newId, index, exclusions)` → materializa `'all'` si el mes tiene algún efectivo no propio (reutiliza `materializeBudgets`). Devuelve el array nuevo.
   - Nuevo `budgetStatus(b: {type, spent, limit})` → `'over' | 'achieved' | 'normal'` (gasto: `spent > limit`; ingreso/ahorro: `limit > 0 && spent >= limit`).
2. `types.ts`: `FinanceState.budgetExclusions?: Record<string, string[]>` (mes → claves `budgetKey`).
3. `App.tsx` (contexto, ~L740-990)
   - `getEffectiveBudgets` pasa `state.budgetExclusions`.
   - Nuevos métodos, cada uno en **un único `setState`** con snapshot de undo tomado **antes** de materializar:
     - `saveBudgetInPeriod(period, original: EffectiveBudget | null, changes)`: `prepareMonthForEdit` → localiza la copia propia por `budgetKey(original)` → aplica cambios; si `original` es null, añade. Quita la clave de `budgetExclusions[period]` si existía.
     - `removeBudgetFromPeriod(period, original: EffectiveBudget)`: `prepareMonthForEdit` → elimina la copia propia → añade la clave a `budgetExclusions[period]`.
   - Snapshot de undo (`budgetUndoStackRef`) guarda también `exclusions` del periodo; `undoBudgetChange` restaura ambos.
   - Arreglar `addBudget` (L873): busca existente por `category && period` sin tipo; usar `budgetKey`.
   - `updateBudget`/`deleteBudget`/`materializeBudgetsForPeriod` se mantienen para Aura (`advisorActions.ts`).
4. `components/Budget.tsx`
   - Eliminar el banner violeta (L313-335), la etiqueta "Heredado de" (L412-416) y el botón "Personalizar" (L420-428).
   - Editar y borrar habilitados en toda tarjeta en vista mensual (`canEdit = isMonthView`); `handleSave` y `handleDeleteClick` usan los métodos nuevos.
   - El texto del estado vacío (L290) deja de decir "Cada mes tiene su propio presupuesto independiente".
5. Tests (`tests/budget-inheritance.test.mjs`): exclusión oculta heredado y legacy; exclusión no afecta a otros meses; `prepareMonthForEdit` deja el mes completo y no toca el origen; un mes siguiente que hereda de un mes con exclusión no recibe esa categoría; `budgetStatus`.

## Fase 2 — Tarjetas de presupuesto: totales compactos y color de tarjeta

`components/Budget.tsx`
- Sustituir las dos tarjetas de totales (L359-378) por **una sola barra compacta**: tres cifras en línea (`Presupuestado · Consumido · Disponible`; en ingresos `Objetivo · Ingresado · Falta`; en ahorros `Objetivo · Aportado · Falta`) y una barra de progreso fina. En móvil `grid-cols-3` con texto pequeño.
- Tarjeta (L392-396): según `budgetStatus`
  - `over` → `bg-rose-50 border-rose-300 dark:bg-rose-950/40 dark:border-rose-800`
  - `achieved` en ingresos → equivalente `emerald` (`bg-emerald-50 border-emerald-300 …`)
  - `achieved` en ahorro → equivalente `amber` (`bg-amber-50 border-amber-300 dark:bg-amber-950/40 dark:border-amber-800`), el color de ahorro de la app
  - `normal` → como hoy.
  - Centralizar el mapa estado+tipo → clases en un helper (`budgetCardTone(type, status)`) para que Presupuestos, Huchas y el Dashboard usen los mismos tonos.
- La cifra (L460) y la barra (L472-480) **siempre** en `b.color`; quitar el `text-rose-500` condicional. La etiqueta (L464-469) conserva el texto ("Excedido", "Logrado"…) con el tono de la tarjeta.
- Mismo tratamiento en el modal de detalle y en las filas del widget de presupuestos del Dashboard (`Dashboard.tsx` L624-633: fondo tintado en la fila, texto en `b.color`).

## Fase 3 — Pestaña Ahorros (objetivo de aportación mensual por hucha)

**Modelo.** Un presupuesto de ahorro es un `Budget` con `type: 'saving'` y `savingId`. Hereda y se materializa igual que los demás.

1. `types.ts`: `Budget.type: 'income' | 'expense' | 'saving'`; `Budget.savingId?: string`.
2. `services/budgetPlan.ts`: `budgetType` reconoce `'saving'` (hoy todo lo que no es `income` pasa a `expense`); `budgetKey` para ahorro = `'saving|' + (savingId || category)`; `materializeBudgets` copia `savingId`.
3. `services/periodIndex.ts`
   - `MonthAggregate` añade `depositsBySaving` y `withdrawalsBySaving` (ponderados con el peso de la hucha, como `netFlowBySaving`).
   - `savingFlow(index, savingId, key)` → `{ deposits, withdrawals }` para mes o año.
   - `periodHeadline(agg)` → `{ income: baseIncome + savingWithdrawals, expense: max(0, netExpense), saving: savingDeposits, result: netResult }`. Son **las mismas definiciones que el widget principal** (`Dashboard.tsx` L103-151). Se reutiliza en fases 5 y 6.
   - `topCategories(agg, 'income' | 'expense', limit)` (generaliza `topExpenseCategories`, que se mantiene como alias).
4. `App.tsx`: `addSaving` genera el id fuera del `setState` y **lo devuelve** (firma `=> string`).
5. `components/Budget.tsx`
   - Tercera pestaña **AHORROS** (icono `PiggyBank`, tono ámbar) junto a GASTOS / INGRESOS (L267-280).
   - Lista = todas las huchas de `savings` + sus presupuestos efectivos del periodo. Nombre, emoji y color salen de la hucha en el render (renombrar no escribe presupuestos). Aportado = `savingFlow(...).deposits`; si hay retiradas, línea secundaria "Retirado: X€".
   - Hucha sin objetivo: tarjeta neutra "Sin objetivo mensual" + botón "Fijar objetivo".
   - Presupuestos de ahorro cuya hucha ya no existe: no se muestran (no se borran).
   - "Nuevo" en Ahorros: selector de huchas sin objetivo + opción "Nueva hucha" (nombre, emoji, meta total opcional). Si es nueva: `addSaving` → id → `saveBudgetInPeriod` con `type: 'saving'`.
   - Si hay ahorro sin hucha (transacciones antiguas con categoría `Ahorro` sin `savingId`), mostrarlo como fila informativa "Sin hucha asignada" en los totales.
6. `components/Savings.tsx`
   - Formulario crear/editar: campo opcional "Objetivo mensual (€)" (solo vista mensual) que llama a `saveBudgetInPeriod` / `removeBudgetFromPeriod`.
   - Tarjeta de hucha: línea "Este mes: X€ de Y€" con barra en el color de la hucha.
   - `deleteSaving` **no** borra en cascada sus presupuestos.
7. Consumidores que asumen dos tipos:
   - `components/Transactions.tsx` `filterCategoriesList` (L76-83): excluir `type === 'saving'`.
   - `components/advisorActions.ts` `periodBudgets` (L108): excluir `saving` para que Aura no confunda nombres de hucha con categorías.
   - `components/advisorContext.ts` (L59-70): etiqueta "aportado" para ahorro.
   - `services/exportData.ts` `budgetsToCsv`: tipo "ahorro".
   - `Dashboard.tsx` `budgetsWithCalculatedSpent` (L219-230): rama `saving` con `savingFlow`.
8. Tests: `period-index` (depósitos/retiradas por hucha, ponderación, `periodHeadline` coincide con la fórmula del widget principal, `topCategories('income')`); `budget-inheritance` (herencia de `saving`, clave por `savingId`, ingreso/gasto/ahorro con el mismo nombre no se pisan); `export-data` y `advisor-actions` si cambian.

## Fase 4 — Navegación desde el widget principal

- `components/Budget.tsx`: `useLocation()`; pestaña inicial `useState(() => location.state?.tab ?? 'expense')` + `useEffect` sobre `location.state` que acepta `'expense' | 'income' | 'saving'`.
- `components/Dashboard.tsx` bloque `balance` (L339-375): las tres tarjetas del desglose pasan a `<button>` → `navigate('/budget', { state: { tab } })`. "Saldo anterior" y "Liquidez actual" → `/accounts`.
- Cabecera y pestañas del widget de presupuestos y filas de la comparativa: misma navegación.

## Fase 5 — Dashboard optimizado

### 5.1 Layout con alias (`services/dashboardBlocks.ts`)
- `DASHBOARD_BLOCKS = ['balance', 'report', 'comparison', 'savings', 'evolution', 'accounts', 'budget']`.
- `LEGACY_ALIASES = { challenges: 'report', chart: 'evolution', trends: 'evolution', categories: null }` aplicado dentro de `mergeLayout` antes de `push` (`null` = descartar). El bloque ocupa la posición de su primer alias y no se duplica. Las claves desconocidas se siguen conservando.
- `constants.tsx` L183: `INITIAL_DATA.dashboardLayout` con las claves nuevas.
- `Dashboard.tsx` L663: ancho completo para `balance` y `evolution`.
- Tests `tests/dashboard-layout.test.mjs`: actualizar "los bloques nuevos aparecen al final" (usa `comparison/categories/trends`) y añadir: alias mapeados, `chart`+`trends` producen un único `evolution` en la posición del primero, `categories` desaparece, idempotencia.

### 5.2 Widget "Evolución" (fusiona `chart` L399-417 y `trends` L512-591)
- Selector principal: **Patrimonio | Ingresos · Gastos · Ahorro | Categorías**. Rango 6/12/24 compartido; "Comparar con el año anterior" en las dos primeras vistas.
- Patrimonio: eje **siempre mensual** con `monthRange` + `getNetWorthHistorical(monthKey)` (corrige la línea plana en vista anual); comparación = línea discontinua con `shiftMonth(key, -12)`.
- Flujo: chips multiselección Ingresos / Gastos / Ahorro (por defecto los tres, mínimo uno). Series desde `periodHeadline` → **Ahorro = `savingDeposits`** (hoy es `netResult`, el fallo reportado).
- Categorías: los chips actuales.
- Eliminar `chartFilter`, `chartData`. Estado de UI solo local, sin persistir.

### 5.3 Widget "Presupuestos" con vista Lista/Gráfico (absorbe `categories` L457-511)
- Pestañas de tipo: **Gastos | Ingresos | Ahorros**. Conmutador de vista: **Lista | Gráfico**.
- Lista: barras actuales con `budgetStatus` (fase 2).
- Gráfico: anillo + leyenda. Gastos → `topCategories(agg, 'expense')`; Ingresos → `topCategories(agg, 'income')`; Ahorros → aportación por hucha. Top 5 + "Otros". Clic en leyenda: gastos/ingresos → `/transactions` con `filterCategory` (ya soportado); ahorros → `/budget` pestaña `saving`.

### 5.4 Comparativa seleccionable (reemplaza L253-278 y L418-456)
- Selector: **Mes anterior | Mismo mes del año pasado | Elegir mes** (`<input type="month">` con `max` = mes actual). En vista anual: **Año anterior | Elegir año**.
- Cabecera "Septiembre 2026 vs Septiembre 2025".
- Filas con `periodHeadline`: Ingresos, Gastos, **Ahorro (`savingDeposits`)** y Resultado. Colores de delta como hoy (gasto: bajar es bueno).

## Fase 6 — Informe de Aura (sustituye a Retos)

1. `services/monthReport.ts` (puro, `today` entra por parámetro):
   `buildMonthReport({ period, today, budgets: EffectiveBudget[], index, savings })` →
   - `kind`: `'progress'` (mes en curso), `'summary'` (mes cerrado o vista anual), `'future'`.
   - `pace` = día / días del mes; cifras de `periodHeadline`; comparación con la media de los 3 meses anteriores con actividad.
   - `watch` (máx. 3, por gravedad): `over` (spent > limit), `at-risk` (≥ 85 %), `projected` (solo en curso: `pace ≥ 0.25`, `spent/limit ≥ 0.5` y `spent/pace > limit × 1.1`).
   - `summary`: presupuestos excedidos, objetivo de ingresos cumplido o no, objetivos de ahorro cumplidos, resultado vs mes anterior, mayor categoría sin presupuesto.
   - Registrar el módulo en `tests/_load.mjs`; nuevo `tests/month-report.test.mjs` (clasificación, proyección desactivada en mes cerrado, límites 0, meses sin datos, vista anual).
2. Widget `report` en `Dashboard.tsx` (en lugar de `challenges` L376-386):
   - Título "Cómo va {mes}" o "Resumen de {mes}". 3-4 líneas + chips de categorías a vigilar (clic → `/budget` con su pestaña).
   - Botón "Comentario de Aura" → IA. Si hay comentario guardado, se muestra; aviso "Actualizar" si cambió `kind` o el número de transacciones del mes.
   - Eliminar `handleGenerateChallenges`, `evaluatedChallenges` y el import de `generateAIChallenges`.
3. IA a petición:
   - `netlify/functions/gemini-core.mts`: acción nueva `monthReport` con prompt fijo en servidor y `responseSchema` `{ titular: string, puntos: string[] (≤ 4), consejo: string }`. El cliente envía **solo el JSON del informe local**, no transacciones. Reutiliza `MODEL_CHALLENGES`. Límite de tamaño con `readString` como las demás.
   - `services/geminiService.ts`: `generateMonthReport(report)`.
   - `types.ts`: `FinanceState.auraReports?: Record<string, { kind, generatedAt, txCount, titular, puntos, consejo }>`. Solo se escribe al pulsar el botón. Añadir a la copia descargable.
   - `tests/gemini-config.test.mjs`: comprobar que la acción existe y su esquema.

## Fase 7 — Aura Vision directo desde el botón flotante

1. Extraer de `components/Transactions.tsx` el formulario de movimiento (estado L56-73, `availableCategories`, `loadScannedItem` L205-254, `handleManualSubmit` L272-345, cola de escaneo, JSX del modal ~L670-880) a **`components/TransactionModal.tsx`**. Mismas llamadas a `addTransaction` / `updateTransaction` / lote de undo; **cero cambios de semántica**.
2. Nuevo **`components/AuraVision.tsx`**: `AuraVisionProvider` + `useAuraVision()`.
   - `<input type="file" accept="image/*">` oculto. Sin `capture`, en móvil el sistema ofrece "Hacer foto" y "Fototeca/Archivo".
   - `openPicker()` llama a `input.click()` **síncronamente dentro del clic** (requisito de gesto del navegador).
   - `handleFileChange` (movido de L176-203): overlay "Aura Vision procesando" (L417-426), `analyzeReceipt`, abre `TransactionModal` con la cola **sobre la pantalla actual**. Resetear `input.value` tras cada selección. Mostrar error visible (hoy solo `console.error`).
   - Montarlo en `App.tsx` dentro de `HashRouter` envolviendo `<main>` (L1011-1026).
3. `QuickAddButton` (`App.tsx` L1543): `onClick={() => { setOpen(false); openPicker(); }}`, sin `navigate`. Eliminar `triggerScan`.
4. `Transactions.tsx`: su botón Aura Vision usa `openPicker()`; "Nueva" y editar usan `TransactionModal`.
5. Servidor: `analyzeReceipt` fija `mimeType: 'image/jpeg'` (`gemini-core.mts` L351). Aceptar `payload.mimeType` de una lista blanca (jpeg, png, webp, heic) y enviarlo desde el cliente (`file.type`).

---

## Ficheros críticos

- `App.tsx` (contexto, undo de presupuestos, `addSaving`, `QuickAddButton`, copia descargable)
- `components/Budget.tsx`, `components/Dashboard.tsx`, `components/Savings.tsx`, `components/Transactions.tsx`
- Nuevos: `components/TransactionModal.tsx`, `components/AuraVision.tsx`, `services/monthReport.ts`
- `services/budgetPlan.ts`, `services/periodIndex.ts`, `services/dashboardBlocks.ts`, `services/geminiService.ts`, `services/exportData.ts`
- `types.ts`, `constants.tsx`, `netlify/functions/gemini-core.mts`
- `components/advisorActions.ts`, `components/advisorContext.ts`
- Tests: `budget-inheritance`, `period-index`, `dashboard-layout`, `gemini-config`, nuevo `month-report`, `_load.mjs`

## Verificación

1. Automática en cada fase: `npm test`, `npm run lint` (tsc), `npm run build`.
2. Manual con `npm run dev`, en un perfil de navegador aparte y con una cuenta de prueba:
   - **Herencia:** un mes sin presupuesto propio muestra los heredados sin avisos. Editar un límite cambia solo ese mes (el mes origen sigue igual). Borrar una categoría heredada no reaparece y el mes siguiente tampoco la hereda. Deshacer revierte edición y borrado.
   - **Tarjetas:** gasto por encima del límite = tarjeta roja con barra y cifra en su color; ingreso alcanzado = tarjeta verde; objetivo de ahorro alcanzado = tarjeta ámbar (nunca verde). Los totales caben en una línea en móvil (~400 px).
   - **Ahorros:** crear una hucha desde Presupuestos → aparece en Huchas. Fijar objetivo mensual desde Huchas → aparece en la pestaña Ahorros. Una aportación a la hucha mueve la barra. El número de transacciones y los saldos de las cuentas no cambian por ninguna de estas acciones.
   - **Dashboard:** un usuario con layout antiguo (`['balance','challenges','savings','chart','accounts','budget']`) ve Informe, Evolución y Presupuestos sin huecos ni duplicados, y **sin guardado al cargar** (revisar que no aparece actividad de sincronización). "Ahorro" coincide en widget principal, comparativa y Evolución. La comparativa con "Mismo mes del año pasado" y con un mes elegido da las mismas cifras que navegar a ese mes. En vista anual, Patrimonio ya no es una línea plana.
   - **Navegación:** Ingresos / Gastos / Ahorro del widget principal abren Presupuestos en su pestaña.
   - **Informe Aura:** mes en curso = ritmo y categorías en riesgo; mes pasado = resumen. "Comentario de Aura" hace una única llamada y queda guardado para ese mes.
   - **Aura Vision:** desde el Dashboard, el botón flotante abre el selector o la cámara sin cambiar de pantalla. Tras analizar aparece el modal de confirmación encima. Descartar no crea nada; confirmar crea exactamente los movimientos confirmados; deshacer los quita. Probar en móvil real (foto con cámara y captura PNG).
