import { Model, QueryWithHelpers, FilterQuery } from "mongoose";

// Check all mandatory fields have been provided
function checkRequired<
  TopLevelDocument,
  NestedDocument,
  StoreWhere extends string,
  ArrayPop extends boolean,
>(
  required: typeof REQUIRED_FIELDS,
  options: ReversePopulateOptions<
    TopLevelDocument,
    NestedDocument,
    StoreWhere,
    ArrayPop
  >,
): void {
  required.forEach((fieldName) => {
    if (options[fieldName] == null)
      throw new Error(`Missing mandatory field ${fieldName}`);
  });
}

// Build the query string with user provided options
function buildQuery<
  TopLevelDocument,
  NestedDocument,
  StoreWhere extends string,
  ArrayPop extends boolean,
>(
  options: ReversePopulateOptions<
    TopLevelDocument,
    NestedDocument,
    StoreWhere,
    ArrayPop
  >,
) {
  // @ts-expect-error _id is a mandatory field on mongoose documents
  const ids = options.modelArray.map((model) => model._id);

  const conditions: FilterQuery<NestedDocument> = {
    ...(options.filters || {}),
    [options.idField]: {
      $in: ids,
    },
  };

  const query: QueryWithHelpers<NestedDocument[], NestedDocument> =
    options.mongooseModel.find<NestedDocument>(conditions);

  if (options.select) {
    const select = getSelectString(options.select, options.idField.toString());
    query.select(select);
  }

  if (options.populate) {
    query.populate(options.populate);
  }
  if (options.sort) {
    query.sort(options.sort);
  }
  if (options.lean === true) {
    query.lean();
  }
  return query;
}

// Ensure the select option always includes the required id field to populate the relationship
function getSelectString(selectStr: string, requiredId: string): string {
  const selected = selectStr.split(" ");
  const idIncluded = selected.includes(requiredId);
  if (!idIncluded) return selectStr + " " + requiredId;
  return selectStr;
}

function populateResult<TopLevelDocument, NestedDocument>(
  storeWhere: string,
  arrayPop: boolean,
  match: TopLevelDocument,
  result: NestedDocument,
): void {
  if (arrayPop) {
    // @ts-expect-error TypeScript doesn't like dynamic property access
    if (typeof match[storeWhere] === "undefined") {
      // @ts-expect-error TypeScript doesn't like dynamic property access
      match[storeWhere] = [];
    }

    // @ts-expect-error TypeScript doesn't like dynamic property access
    match[storeWhere].push(result);
  } else {
    // @ts-expect-error TypeScript doesn't like dynamic property access
    match[storeWhere] = result;
  }
}

function createPopulateResult<TopLevelDocument, NestedDocument>(
  storeWhere: string,
  arrayPop: boolean,
): (match: TopLevelDocument, result: NestedDocument) => void {
  // Return a function that only requires the remaining two parameters
  return function (match, result) {
    populateResult(storeWhere, arrayPop, match, result);
  };
}

/**
 * Options for reverse populating Mongoose documents.
 *
 * @template TopLevelDocument - The type of documents in the modelArray
 * @template NestedDocument - The type of documents being populated
 * @template StoreWhere - The property name where populated documents will be stored
 * @template ArrayPop - Whether to store as array (true) or single value (false)
 */
export interface ReversePopulateOptions<
  TopLevelDocument,
  NestedDocument,
  StoreWhere extends string,
  ArrayPop extends boolean,
> {
  /** Array of documents to populate with related documents */
  modelArray: TopLevelDocument[];

  /** Property name where the populated documents will be stored */
  storeWhere: StoreWhere;

  /** If true, stores populated documents as array; if false, as single value */
  arrayPop: ArrayPop;

  /** Mongoose model to query for related documents */
  mongooseModel: Model<NestedDocument>;

  /** Field in the related documents that contains the reference ID */
  idField: keyof NestedDocument;

  /** Optional MongoDB query filters for the related documents */
  filters?: FilterQuery<NestedDocument>;

  /** Optional sort criteria for the related documents */
  sort?: string;

  /** Optional populate configuration for nested relationships */
  populate?:
    | {
        path: string;
        select?: string;
        populate?: {
          path: string;
          select: string;
        };
      }[]
    | string[];

  /** Optional field selection for the related documents */
  select?: string;

  /**
   * If true, returns related documents as plain JavaScript objects instead of Mongoose documents.
   * This improves performance and reduces memory usage. Default: false.
   */
  lean?: boolean;
}

const REQUIRED_FIELDS = [
  "modelArray",
  "storeWhere",
  "arrayPop",
  "mongooseModel",
  "idField",
] as const;

/**
 * Populates documents with related documents where the reference is stored on the related model.
 *
 * This function solves the "reverse populate" problem in Mongoose, where you need to populate
 * a model with documents that reference it, but the reference is stored on the other model.
 *
 * @template TopLevelDocument - The type of documents to populate
 * @template NestedDocument - The type of related documents
 * @template StoreWhere - The property name where populated documents will be stored
 * @template ArrayPop - Whether to store as array (true) or single value (false)
 *
 * @param options - Configuration options for the reverse populate operation
 * @returns Promise resolving to the populated documents
 *
 * @example
 * ```typescript
 * const authors = await Author.find();
 * const options = {
 *   modelArray: authors,
 *   storeWhere: "posts",
 *   arrayPop: true,
 *   mongooseModel: Post,
 *   idField: "author",
 *   lean: true  // Optional: for better performance
 * };
 * const authorsWithPosts = await reversePopulate(options);
 * // Each author now has a .posts property with their posts
 * ```
 */
export async function reversePopulate<
  TopLevelDocument,
  NestedDocument,
  StoreWhere extends string,
  ArrayPop extends boolean,
>(
  options: ReversePopulateOptions<
    TopLevelDocument,
    NestedDocument,
    StoreWhere,
    ArrayPop
  >,
): Promise<
  ArrayPop extends true
    ? (TopLevelDocument & { [key in StoreWhere]: NestedDocument[] })[]
    : (TopLevelDocument & { [key in StoreWhere]: NestedDocument })[]
> {
  // Check required fields have been provided
  checkRequired(REQUIRED_FIELDS, options);

  const { modelArray, storeWhere, arrayPop, idField } = options;

  // If empty array passed, exit!
  if (!modelArray.length) {
    return [];
  }

  // Transform the model array for easy lookups
  let modelIndex: Record<string, TopLevelDocument> = {};
  modelArray.forEach((model) => {
    modelIndex = {
      ...modelIndex,
      // @ts-expect-error _id is a mandatory field on mongoose documents
      [model._id as string]: model,
    };
  });

  const populateResult = createPopulateResult(storeWhere, arrayPop);

  const query = buildQuery(options);

  // Do the query
  const documents = await query.exec();

  // Map over results (models to be populated)
  documents.forEach((document) => {
    // Check if the ID field is an array
    const _id = document[idField];

    const isArray = Array.isArray(_id);

    // If _id is an array, map through this
    if (isArray) {
      _id.forEach((individualId) => {
        const match = modelIndex[individualId];
        // If match found, populate the result inside the match
        if (match) {
          populateResult(match, document);
        }
      });
    } else {
      // Id field is not an array
      // So just add the result to the model
      const match = modelIndex[_id as string];

      // If match found, populate the result inside the match
      if (match) {
        populateResult(match, document);
      }
    }
  });

  // Callback with passed modelArray
  // @ts-expect-error As we dynamically add the populated field, this throws an error
  return modelArray;
}
