-- D49: The Pick/Drop List "appointment" field becomes free text instead of a
-- yes/no checkbox. Nate wants to write in dock hours, "call for appointment",
-- or whatever a given location needs — an annotation, not a rule (D20). The old
-- boolean `appointment_required` is renamed to `appointment_note` and retyped
-- to text; existing `true` values are preserved as a readable note.
alter table locations alter column appointment_required drop default;
alter table locations alter column appointment_required drop not null;
alter table locations rename column appointment_required to appointment_note;
alter table locations alter column appointment_note type text
  using (case when appointment_note then 'Appointment required' else null end);
