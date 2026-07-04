-- Fix DELETE policy to allow authenticated users to delete any incident
-- (including those inserted by Apps Script with user_id = NULL)

DROP POLICY IF EXISTS "Users can delete their own incidents" ON incidents;

CREATE POLICY "Authenticated users can delete incidents" ON incidents
	FOR DELETE
	USING (auth.uid() IS NOT NULL);

-- Also fix UPDATE policy to allow updating incidents with user_id = NULL
DROP POLICY IF EXISTS "Users can update their own incidents" ON incidents;

CREATE POLICY "Authenticated users can update incidents" ON incidents
	FOR UPDATE
	USING (auth.uid() IS NOT NULL)
	WITH CHECK (auth.uid() IS NOT NULL);
