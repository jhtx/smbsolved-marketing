import { Config } from '@remotion/cli/config';

Config.setVideoImageFormat('jpeg');
Config.setCodec('h264');
Config.setCrf(18);
Config.setEntryPoint('./src/index.ts');
