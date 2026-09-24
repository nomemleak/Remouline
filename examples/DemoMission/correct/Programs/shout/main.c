#include "shout.h"

int main(int argc, char **argv)
{
    if (argc != 2)
        return 84;
    shout(argv[1]);
    return 0;
}
