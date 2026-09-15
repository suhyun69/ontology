import { useState } from "react";
import {
  Button,
  Callout,
  Classes,
  Dialog,
  DialogBody,
  DialogFooter,
  FormGroup,
  HTMLSelect,
  InputGroup,
  NumericInput,
  Switch,
} from "@blueprintjs/core";
import { DateInput } from "@blueprintjs/datetime";
import { enUS } from "date-fns/locale";
import { ApiError, runAction } from "./api.ts";
import type { ActionResult, ActionType } from "./api.ts";
import { missingRequired, readActionFields, toRequestBody } from "./actionForm.ts";
import type { ActionField, FieldValue } from "./actionForm.ts";

type ActionDialogProps = {
  action: ActionType;
  objectType: string;
  objectId: string;
  onClose: () => void;
  /** Fires once the action has run, so the detail behind the dialog refetches. */
  onCompleted: () => void;
};

/** How a date is written in the input; the value itself stays an ISO string. */
const DATE_TIME_FORMAT = "yyyy-MM-dd HH:mm";
const DATE_ONLY_FORMAT = "yyyy-MM-dd";

/**
 * How far either way the date picker will go.
 *
 * Left alone, DateInput refuses anything more than six months out -- that is
 * its default maxDate, and it is a rule this ontology never stated. What a
 * parameter may hold is the schema's business, and whether a particular
 * instance accepts it is the handler's; the control should not quietly add a
 * third and narrower rule of its own.
 */
const DATE_RANGE_YEARS = 20;

function yearsFromNow(offset: number): Date {
  const date = new Date();
  date.setFullYear(date.getFullYear() + offset);
  return date;
}

const MIN_DATE = yearsFromNow(-DATE_RANGE_YEARS);
const MAX_DATE = yearsFromNow(DATE_RANGE_YEARS);

export function ActionDialog({
  action,
  objectType,
  objectId,
  onClose,
  onCompleted,
}: ActionDialogProps) {
  const [fields] = useState(() => readActionFields(action.parameter_schema));
  const [values, setValues] = useState<Record<string, FieldValue>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [result, setResult] = useState<ActionResult | null>(null);

  const setValue = (name: string, value: FieldValue) =>
    setValues((current) => ({ ...current, [name]: value }));

  const missing = missingRequired(fields, values);
  const done = result !== null;

  const submit = () => {
    setSubmitting(true);
    setError(null);

    runAction(objectType, objectId, action.api_name, toRequestBody(fields, values))
      .then((completed) => {
        setResult(completed);
        // The action wrote to the instance being shown, so what is on screen
        // behind this dialog is now stale.
        onCompleted();
      })
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught : new Error(String(caught)));
      })
      .finally(() => setSubmitting(false));
  };

  return (
    <Dialog isOpen title={action.name} icon="lightning" onClose={onClose} canOutsideClickClose={!submitting}>
      <DialogBody>
        {action.description !== null && (
          <p className={Classes.TEXT_MUTED}>{action.description}</p>
        )}

        {done ? (
          <Callout intent="success" icon="tick-circle" title="Action ran">
            <pre className="ox-json ox-result">{JSON.stringify(result.result, null, 2)}</pre>
          </Callout>
        ) : (
          <>
            {fields.length === 0 && (
              <p className={Classes.TEXT_MUTED}>This action takes no parameters.</p>
            )}

            {fields.map((field) => (
              <ActionFieldControl
                key={field.name}
                field={field}
                value={values[field.name] ?? null}
                disabled={submitting}
                onChange={(value) => setValue(field.name, value)}
              />
            ))}

            {error !== null && (
              <Callout intent="danger" icon="error" title="Could not run the action">
                {error.message}
                {error instanceof ApiError && error.details !== null && (
                  <pre className="ox-json ox-result">{JSON.stringify(error.details, null, 2)}</pre>
                )}
              </Callout>
            )}
          </>
        )}
      </DialogBody>

      <DialogFooter
        actions={
          done ? (
            <Button intent="primary" text="Close" onClick={onClose} />
          ) : (
            <>
              <Button text="Cancel" onClick={onClose} disabled={submitting} />
              <Button
                intent="primary"
                text="Run"
                loading={submitting}
                disabled={missing.length > 0}
                onClick={submit}
              />
            </>
          )
        }
      >
        {!done && missing.length > 0 && (
          <span className={Classes.TEXT_MUTED}>Required: {missing.join(", ")}</span>
        )}
      </DialogFooter>
    </Dialog>
  );
}

// ---------------------------------------------------------------- controls

function ActionFieldControl({
  field,
  value,
  disabled,
  onChange,
}: {
  field: ActionField;
  value: FieldValue;
  disabled: boolean;
  onChange: (value: FieldValue) => void;
}) {
  return (
    <FormGroup
      label={field.label}
      labelFor={field.name}
      labelInfo={field.required ? "(required)" : undefined}
      helperText={field.description ?? undefined}
    >
      <FieldControl field={field} value={value} disabled={disabled} onChange={onChange} />
    </FormGroup>
  );
}

function FieldControl({
  field,
  value,
  disabled,
  onChange,
}: {
  field: ActionField;
  value: FieldValue;
  disabled: boolean;
  onChange: (value: FieldValue) => void;
}) {
  switch (field.kind) {
    case "datetime": {
      // A `date` names a calendar day, so it gets no clock; `date-time` names
      // an instant and gets one. Seconds are normalised on the way out rather
      // than shown here (see toRequestBody).
      const withTime = field.dateFormat !== "date";

      return (
        <DateInput
          inputProps={{ id: field.name }}
          value={typeof value === "string" ? value : null}
          onChange={(next) => onChange(next)}
          dateFnsFormat={withTime ? DATE_TIME_FORMAT : DATE_ONLY_FORMAT}
          {...(withTime ? { timePrecision: "minute" as const } : {})}
          minDate={MIN_DATE}
          maxDate={MAX_DATE}
          disabled={disabled}
          fill
          placeholder={withTime ? DATE_TIME_FORMAT : DATE_ONLY_FORMAT}
          highlightCurrentDay
          // Handed over directly. Left to itself DateInput dynamically imports
          // the locale from date-fns, which it only reaches as a transitive
          // dependency -- the bare specifier does not resolve in the browser
          // and every render logs a failure.
          locale={enUS}
        />
      );
    }

    case "enum":
      return (
        <HTMLSelect
          id={field.name}
          value={typeof value === "string" ? value : ""}
          disabled={disabled}
          fill
          onChange={(event) => onChange(event.currentTarget.value)}
          options={[{ label: "Select…", value: "" }, ...field.options]}
        />
      );

    case "number":
      return (
        <NumericInput
          id={field.name}
          value={typeof value === "number" ? value : ""}
          disabled={disabled}
          fill
          buttonPosition="right"
          onValueChange={(asNumber) => onChange(Number.isNaN(asNumber) ? null : asNumber)}
        />
      );

    case "boolean":
      return (
        <Switch
          id={field.name}
          checked={value === true}
          disabled={disabled}
          onChange={(event) => onChange(event.currentTarget.checked)}
        />
      );

    default:
      return (
        <InputGroup
          id={field.name}
          value={typeof value === "string" ? value : ""}
          disabled={disabled}
          fill
          onChange={(event) => onChange(event.currentTarget.value)}
        />
      );
  }
}
