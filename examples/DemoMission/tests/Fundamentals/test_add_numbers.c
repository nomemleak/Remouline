// Fundamentals/test_add_numbers.c
#include <criterion/criterion.h>
#include <limits.h>
#include "add_numbers.h"

Test(add_numbers, positive_values)
{
    int result = add_numbers(2, 3);

    cr_assert(result == 5, "Expected 5 but got %d", result);
}

Test(add_numbers, negative_values)
{
    int result = add_numbers(-4, -6);

    cr_assert(result == -10, "Expected -10 but got %d", result);
}

Test(add_numbers, zero)
{
    int result = add_numbers(0, 0);

    cr_assert(result == 0, "Expected 0 but got %d", result);
}
