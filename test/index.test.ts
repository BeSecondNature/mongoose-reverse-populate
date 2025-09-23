import { reversePopulate } from "../src/index";

import assert from "assert";
import {
  connect,
  Schema,
  model,
  Types,
  HydratedDocument,
  Model,
} from "mongoose";

interface CategoryData {
  _id: Types.ObjectId;
  name: string;
}

interface PostData {
  _id: Types.ObjectId;
  title: string;
  categories: Types.ObjectId[];
  author: Types.ObjectId;
  content: string;
}

interface AuthorData {
  _id: Types.ObjectId;
  firstName: string;
  lastName: string;
}

interface PersonData {
  _id: Types.ObjectId;
  firstName: string;
  lastName: string;
  dob: Date;
}

interface PassportData {
  _id: Types.ObjectId;
  number: string;
  expiry: Date;
  owner: Types.ObjectId;
}

const rando = () => {
  return Math.floor(Math.random() * (1 << 24)).toString(16);
};

describe("reverse populate", () => {
  before(async () => {
    try {
      await connect("mongodb://localhost/mongoose-reverse-populate-test");
    } catch (err) {
      throw new Error("Could not connect to MongoDB");
    }
  });

  describe("multiple results", () => {
    let Category: Model<CategoryData>,
      Post: Model<PostData>,
      Author: Model<AuthorData>;
    let categories: HydratedDocument<CategoryData>[],
      posts: HydratedDocument<PostData>[],
      authors: HydratedDocument<AuthorData>[];

    // define schemas and models for tests
    before(async () => {
      // a category has many posts
      const categorySchema = new Schema<CategoryData>({
        name: String,
      });
      Category = model<CategoryData>("Category", categorySchema);

      // a post can have many categories
      // a post can ONLY have one author
      const postSchema = new Schema<PostData>({
        title: String,
        categories: [{ type: Schema.Types.ObjectId, ref: "Category" }],
        author: { type: Schema.Types.ObjectId, ref: "Author" },
        content: String,
      });
      Post = model<PostData>("Post", postSchema);

      // an author has many posts
      const authorSchema = new Schema<AuthorData>({
        firstName: String,
        lastName: String,
      });
      Author = model<AuthorData>("Author", authorSchema);
    });

    // create 2 x categories, 1 x author and 10 x posts
    beforeEach(async () => {
      const category = await Category.create({
        name: rando(),
      });
      categories = [category];

      const category2 = await Category.create({
        name: rando(),
      });
      categories.push(category2);

      const author = await Author.create({
        firstName: rando(),
        lastName: rando(),
      });
      authors = [author];

      // create multi category posts
      posts = [];
      for (let i = 0; i < 5; i++) {
        const newPost = new Post({
          title: rando(),
          categories: categories,
          author: author,
          content: rando(),
        });
        posts.push(newPost);
        await newPost.save();
      }
    });

    afterEach(async () => {
      await Category.deleteMany({});
      await Post.deleteMany({});
      await Author.deleteMany({});
    });

    const required = [
      "modelArray",
      "storeWhere",
      "arrayPop",
      "mongooseModel",
      "idField",
    ];
    required.forEach((fieldName) => {
      it(`check mandatory field ${fieldName}`, async () => {
        const msg = "Missing mandatory field ";

        let opts = {
          modelArray: categories,
          storeWhere: "posts" as const,
          arrayPop: true as const,
          mongooseModel: Post,
          idField: "categories" as const,
        };

        opts = { ...opts, [fieldName]: undefined };

        try {
          await reversePopulate(opts);
        } catch (err) {
          assert.notDeepEqual(err, null);
          assert.equal((err as Error).message, msg + fieldName);
        }
      });
    });

    // populate categories with their associated posts when the relationship is stored on the post model
    it("should successfully reverse populate a many-to-many relationship", async () => {
      const opts = {
        modelArray: categories,
        storeWhere: "posts" as const,
        arrayPop: true as const,
        mongooseModel: Post,
        idField: "categories" as const,
      };

      const catResult = await reversePopulate(opts);
      // expect catResult and categories to be the same
      assert.equal(catResult.length, 2);
      idsMatch(catResult, categories);

      // expect each catResult to contain the posts
      catResult.forEach((category) => {
        assert.equal(category.posts.length, 5);
        idsMatch(category.posts, posts);
      });
    });

    //populate authors with their associated posts when the relationship is stored on the post model
    it("should successfully reverse populate a one-to-many relationship", async () => {
      const opts = {
        modelArray: authors,
        storeWhere: "posts" as const,
        arrayPop: true as const,
        mongooseModel: Post,
        idField: "author" as const,
      };
      const authResult = await reversePopulate(opts);
      //expect catResult and categories to be the same
      assert.equal(authResult.length, 1);
      idsMatch(authResult, authors);

      //expect each catResult to contain the posts
      authResult.forEach((author) => {
        idsMatch(author.posts, posts);
        assert.equal(author.posts.length, 5);

        // Verify default behavior returns Mongoose documents with methods
        // @ts-expect-error PostData interface doesn't include Mongoose methods
        assert.equal(typeof author.posts[0].save, "function");
        // @ts-expect-error PostData interface doesn't include Mongoose methods
        assert.equal(typeof author.posts[0].populate, "function");
      });
    });

    //test to ensure filtering results works as expected
    it('should "filter" the query results', async () => {
      //pick a random post to be filtered (the first one)
      const firstPost = posts[0];

      const opts = {
        modelArray: authors,
        storeWhere: "posts" as const,
        arrayPop: true as const,
        mongooseModel: Post,
        idField: "author" as const,
        filters: { title: { $ne: firstPost.title } },
      };
      const authResult = await reversePopulate(opts);
      assert.equal(authResult.length, 1);
      const author = authResult[0];

      //the authors posts should exclude the title passed as a filter
      //there are 10 posts for this author and 1 title is excluded so expect 9
      assert.equal(author.posts.length, 4);
      author.posts.forEach((post) => {
        assert.notEqual(firstPost.title, post.title);
      });
    });

    it('should "select" only the desired fields', async () => {
      const opts = {
        modelArray: authors,
        storeWhere: "posts" as const,
        arrayPop: true as const,
        mongooseModel: Post,
        idField: "author" as const,
        select: "title",
      };
      const authResult = await reversePopulate(opts);
      assert.equal(authResult.length, 1);
      const author = authResult[0];

      assert.equal(author.posts.length, 5);
      author.posts.forEach((post) => {
        //expect these two to be populated
        //author is automatically included as it's required to perform the populate
        assert.notEqual(typeof post.author, "undefined");
        assert.notEqual(typeof post.title, "undefined");
        //expect this to be undefined
        assert.equal(typeof post.categories, "undefined");
      });
    });

    it('should "sort" the results returned', async () => {
      const sortedTitles = posts.map((post) => post.title).sort();

      const opts = {
        modelArray: authors,
        storeWhere: "posts" as const,
        arrayPop: true as const,
        mongooseModel: Post,
        idField: "author" as const,
        sort: "title",
      };
      const authResult = await reversePopulate(opts);
      assert.equal(authResult.length, 1);
      const author = authResult[0];

      assert.equal(author.posts.length, 5);
      const postTitles = author.posts.map((post) => post.title);
      assert.deepEqual(sortedTitles, postTitles);
    });

    // use reverse populate to populate posts within author
    // use standard populate to nest categories in posts
    it('should "populate" the results returned', async () => {
      const opts = {
        modelArray: authors,
        storeWhere: "posts" as const,
        arrayPop: true as const,
        mongooseModel: Post,
        idField: "author" as const,
        populate: ["categories"],
      };
      const authResult = await reversePopulate(opts);
      assert.equal(authResult.length, 1);
      idsMatch(authResult, authors);

      const author = authResult[0];
      author.posts.forEach((post) => {
        assert.equal(post.categories.length, 2);
        post.categories.forEach((category) => {
          // @ts-expect-error category has been populated, but reversePopulate is not yet typed to reflect this
          assert.equal(typeof category.name, "string");
        });
        idsMatch(post.categories, categories);
      });
    });

    it("should return lean documents when lean option is true", async () => {
      const opts = {
        modelArray: authors,
        storeWhere: "posts" as const,
        arrayPop: true as const,
        mongooseModel: Post,
        idField: "author" as const,
        lean: true,
      };
      const authResult = await reversePopulate(opts);
      assert.equal(authResult.length, 1);
      idsMatch(authResult, authors);

      const author = authResult[0];
      assert.equal(author.posts.length, 5);

      // Verify that posts are plain objects (lean documents)
      author.posts.forEach((post) => {
        // Lean documents should be plain objects without Mongoose document methods
        assert.equal(post.constructor.name, "Object");
        // Verify the post still has the expected properties
        assert.notEqual(typeof post.title, "undefined");
        assert.notEqual(typeof post.author, "undefined");
        assert.notEqual(typeof post.content, "undefined");
        // Check that it doesn't have Mongoose document methods
        // @ts-expect-error These methods don't exist on the PostData interface but would on Mongoose documents
        assert.equal(typeof post.save, "undefined");
        // @ts-expect-error These methods don't exist on the PostData interface but would on Mongoose documents
        assert.equal(typeof post.populate, "undefined");
      });
    });

    it("should return Mongoose documents when lean option is false", async () => {
      const opts = {
        modelArray: authors,
        storeWhere: "posts" as const,
        arrayPop: true as const,
        mongooseModel: Post,
        idField: "author" as const,
        lean: false,
      };
      const authResult = await reversePopulate(opts);
      assert.equal(authResult.length, 1);
      idsMatch(authResult, authors);

      const author = authResult[0];
      assert.equal(author.posts.length, 5);

      // Verify that posts are Mongoose documents with methods
      author.posts.forEach((post) => {
        // Mongoose documents should have these methods
        // @ts-expect-error PostData interface doesn't include Mongoose methods
        assert.equal(typeof post.save, "function");
        // @ts-expect-error PostData interface doesn't include Mongoose methods
        assert.equal(typeof post.populate, "function");
        // @ts-expect-error PostData interface doesn't include Mongoose methods
        assert.equal(typeof post.toObject, "function");
        // @ts-expect-error PostData interface doesn't include Mongoose methods
        assert.equal(typeof post.toJSON, "function");
        // Should not be a plain Object
        assert.notEqual(post.constructor.name, "Object");
        // Verify the post still has the expected properties
        assert.notEqual(typeof post.title, "undefined");
        assert.notEqual(typeof post.author, "undefined");
        assert.notEqual(typeof post.content, "undefined");
      });
    });

    // test comparison between lean true and false
    it("should behave differently with lean true vs false", async () => {
      // Get fresh author instances for each test to avoid interference
      const authorsForLean = await Author.find();
      const authorsForNonLean = await Author.find();

      const optsLean = {
        modelArray: authorsForLean,
        storeWhere: "posts" as const,
        arrayPop: true as const,
        mongooseModel: Post,
        idField: "author" as const,
        lean: true,
      };

      const optsNonLean = {
        modelArray: authorsForNonLean,
        storeWhere: "posts" as const,
        arrayPop: true as const,
        mongooseModel: Post,
        idField: "author" as const,
        lean: false,
      };

      const leanResult = await reversePopulate(optsLean);
      const nonLeanResult = await reversePopulate(optsNonLean);

      const leanPost = leanResult[0].posts[0];
      const nonLeanPost = nonLeanResult[0].posts[0];

      // Data should be the same
      assert.equal(leanPost.title, nonLeanPost.title);
      assert.equal(leanPost.content, nonLeanPost.content);

      // For lean documents
      assert.equal(leanPost.constructor.name, "Object");
      // @ts-expect-error PostData interface doesn't include Mongoose methods
      assert.equal(typeof leanPost.save, "undefined");

      // For non-lean documents - they should have Mongoose methods
      // The specific constructor name might vary, but it should have methods
      // @ts-expect-error PostData interface doesn't include Mongoose methods
      const hasSaveMethod = typeof nonLeanPost.save === "function";
      // @ts-expect-error PostData interface doesn't include Mongoose methods
      const hasPopulateMethod = typeof nonLeanPost.populate === "function";

      assert.equal(
        hasSaveMethod,
        true,
        "Non-lean document should have save method",
      );
      assert.equal(
        hasPopulateMethod,
        true,
        "Non-lean document should have populate method",
      );
    });
  });

  describe("singular results", () => {
    let Person: Model<PersonData>, Passport: Model<PassportData>;
    let person1: HydratedDocument<PersonData>,
      passport1: HydratedDocument<PassportData>,
      passport2: HydratedDocument<PassportData>;

    // define schemas and models for tests
    before(async () => {
      // a person has one passport
      const personSchema = new Schema<PersonData>({
        firstName: String,
        lastName: String,
        dob: Date,
      });
      Person = model<PersonData>("Person", personSchema);

      // a passport has one owner (person)
      const passportSchema = new Schema<PassportData>({
        number: String,
        expiry: Date,
        owner: { type: Schema.Types.ObjectId, ref: "Person" },
      });
      Passport = model<PassportData>("Passport", passportSchema);
    });

    // create 2 x people, 2 x passports
    beforeEach(async () => {
      const person = await Person.create({
        firstName: rando(),
        lastName: rando(),
        dob: new Date(1984, 6, 27),
      });

      person1 = person;

      const passport = await Passport.create({
        number: rando(),
        expiry: new Date(2017, 1, 1),
        owner: person,
      });

      passport1 = passport;

      const secondPerson = await Person.create({
        firstName: rando(),
        lastName: rando(),
        dob: new Date(1984, 6, 27),
      });

      const secondPassport = await Passport.create({
        number: rando(),
        expiry: new Date(2017, 1, 1),
        owner: secondPerson,
      });
      passport2 = secondPassport;
    });

    afterEach(async () => {
      await Person.deleteMany({});
      await Passport.deleteMany({});
    });

    it("should successfully reverse populate a one-to-one relationship", async () => {
      const persons = await Person.find({});
      const opts = {
        modelArray: persons,
        storeWhere: "passport" as const,
        arrayPop: false as const,
        mongooseModel: Passport,
        idField: "owner" as const,
      };
      // as this is one-to-one result should not be populated inside an array
      const personsResult = await reversePopulate(opts);
      personsResult.forEach((person) => {
        // if this is person1, check against passport1
        if (person._id.equals(person1._id)) {
          idMatch(person.passport, passport1);
          // if this is person2, check against passport2
        } else {
          idMatch(person.passport, passport2);
        }
      });
    });
  });
});

/*
 * Helper functions
 */

// compare an array of mongoose objects
const idsMatch = <
  T extends Record<"_id", Types.ObjectId>,
  K extends Record<"_id", Types.ObjectId>,
>(
  arr1: T[],
  arr2: K[],
) => {
  assert.equal(arr1.length, arr2.length);

  const arr1IDs = pluckIds(arr1);
  const arr2IDs = pluckIds(arr2);

  const diff = arr1IDs.filter((id) => !arr2IDs.includes(id));
  assert.equal(diff.length, 0);
};

const pluckIds = <T extends Record<string, Types.ObjectId>>(array: T[]) =>
  array.map((obj) => obj._id.toString());

// compare two mongoose objects using _id
const idMatch = <
  T extends Record<"_id", Types.ObjectId>,
  K extends Record<"_id", Types.ObjectId>,
>(
  obj1: T,
  obj2: K,
) => {
  const compare = obj1._id.equals(obj2._id);
  assert(compare);
};
