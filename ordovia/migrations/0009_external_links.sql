-- Ordovia 0009: links to things outside Ordovia (a SharePoint or OneDrive file, a Teams channel, any web page).
-- The end of such a link has type 'url', id 0 and the address in b_sub; `title` is what people see.
-- The file stays where it lives: Ordovia only knows where it is and shows it at the right step, object or case.

ALTER TABLE links ADD COLUMN title TEXT;
