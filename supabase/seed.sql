-- Sample CASAS-aligned question bank. Add more per level for real use —
-- this only seeds enough to test the app end to end.

insert into quiz_questions (casas_level, prompt, choices, correct_index, topic) values
(1, 'What is 3 + 4?',                         '["5","6","7","8"]',           2, 'single-digit-addition'),
(1, 'What is 9 - 5?',                         '["2","3","4","5"]',           2, 'single-digit-subtraction'),
(1, 'What is 6 + 2?',                         '["6","7","8","9"]',           2, 'single-digit-addition'),
(1, 'What is 10 - 4?',                        '["4","5","6","7"]',           2, 'single-digit-subtraction'),
(1, 'What is 5 + 5?',                         '["8","9","10","11"]',         2, 'single-digit-addition'),
(1, 'What is 7 - 3?',                         '["2","3","4","5"]',           2, 'single-digit-subtraction'),
(2, 'What is 12 x 3?',                        '["24","32","36","42"]',       2, 'multiplication'),
(2, 'What is 45 / 9?',                        '["4","5","6","9"]',           1, 'division'),
(2, 'What is 18 + 27?',                       '["35","40","45","55"]',       2, 'two-digit-addition'),
(2, 'What is 60 - 24?',                       '["26","36","44","46"]',       1, 'two-digit-subtraction'),
(3, 'What is 1/4 of 80?',                     '["16","20","24","40"]',       1, 'fractions'),
(3, 'What is 15% of 200?',                    '["15","20","25","30"]',       2, 'percentages'),
(4, 'Solve for x: 2x + 6 = 20',               '["5","6","7","8"]',           2, 'basic-algebra'),
(4, 'What is the ratio 8:12 simplified?',     '["1:2","2:3","3:4","4:5"]',   1, 'ratios'),
(5, 'Solve for x: 3x - 5 = 2x + 7',           '["10","11","12","13"]',       2, 'algebra'),
(5, 'A shirt costs $40 after a 20% discount. What was the original price?', '["$45","$48","$50","$52"]', 2, 'percent-word-problems');
