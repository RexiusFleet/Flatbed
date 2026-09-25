-- D101: remove the placeholder created by the retired global designation
-- toolbar. Time Window choices are managed through the Bagger column now.
delete from categories
where lower(trim(name)) = 'new designation'
  and is_off = false;
