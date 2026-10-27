import {IUserContext} from "../../..";

import {sampleUser} from "../samples/profiles";

/** The sample user as a call's `userContext`: `sampleUser` with `now`. */
export const sampleUserContext: IUserContext = {
  ...sampleUser,
  now: new Date(),
};
