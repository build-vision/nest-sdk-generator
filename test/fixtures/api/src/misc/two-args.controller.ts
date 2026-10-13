import { Controller } from '@nestjs/common'

// More than one argument: skipped
@Controller('a', 'b')
export class TwoArgsController {}
